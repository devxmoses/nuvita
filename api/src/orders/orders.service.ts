import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { DeliveryZonesService } from '../delivery-zones/delivery-zones.service';
import { VendorOrderStatus } from '../../generated/prisma/enums';

@Injectable()
export class OrdersService {
  constructor (
    private readonly prisma:PrismaService,
    private readonly deliveryZones:DeliveryZonesService,
  ){}
  async create(buyerId:string, createOrderDto:CreateOrderDto) {

    return this.prisma.$transaction(async (tx)=>{
      const cart = await tx.cart.findUnique({
        where:{userId:buyerId},
        include:{items:{include:{product:true, variant:true}}},
      })
      if(!cart || cart.items.length === 0) throw new BadRequestException(`Your cart is empty`)

    const address = await tx.address.findFirst({
        where:{id:createOrderDto.shippingAddressId, userId:buyerId},
      });
      if(!address){
        throw new NotFoundException(
          `Address with ID ${createOrderDto.shippingAddressId} not found`,
        );
      }

      const itemsData = cart.items.map((cartItem)=>{
        const product = cartItem.product;
        const variant = cartItem.variant;

        if(!product.isActive){
          throw new BadRequestException(`Product ${product.name} is no longer available`);
        }
        if(variant && !variant.isActive){
          throw new BadRequestException(
            `${product.name} (${variant.name}) is no longer available`,
          );
        }

        return{
          productId:product.id,
          vendorId:product.vendorId,
          variantId:variant?.id ?? null,
          productName:product.name,
          variantName:variant?.name ?? null,
          quantity: cartItem.quantity,
          unitPrice: variant?.price ?? product.price,
        }
      });

      for (const item of itemsData){
        if(item.variantId){
          const result = await tx.productVariant.updateMany({
            where:{id:item.variantId, stock:{gte:item.quantity}},
            data:{stock:{decrement:item.quantity}}
          });
          if(result.count === 0){
            throw new ConflictException(
              `Not enough stock for "${item.productName} (${item.variantName})"`,
            )
          }
        } else {
          const result = await tx.product.updateMany({
            where:{id:item.productId, stock:{gte:item.quantity}},
            data:{stock:{decrement:item.quantity}}
          });
          if(result.count === 0){
            throw new ConflictException(`Not enough stock for "${item.productName}"`)
          }
        }
      }

      // one group per vendor: each fulfils its own part on its own timeline
      const byVendor = new Map<string, typeof itemsData>();
      for(const item of itemsData){
        const group = byVendor.get(item.vendorId) ?? [];
        group.push(item);
        byVendor.set(item.vendorId, group);
      }

      const itemsTotal = itemsData.reduce((sum,i)=>sum + i.unitPrice * i.quantity,0);

      const target = {country:address.country, state:address.state, city:address.city};
      const groups:{vendorId:string; subtotal:number; deliveryFee:number; items:typeof itemsData}[] = [];

      for(const [vendorId, items] of byVendor){
        const subtotal = items.reduce((sum,i)=>sum + i.unitPrice * i.quantity,0);

        // resolved inside the transaction, so the zones priced against here
        // cannot change between quoting and writing
        const delivery = await this.deliveryZones.resolve(vendorId, target, subtotal, tx);
        if(!delivery){
          const vendor = await tx.vendor.findUnique({
            where:{id:vendorId},
            select:{name:true},
          });
          throw new BadRequestException(
            `${vendor?.name ?? 'A vendor'} does not deliver to ${address.city}, ${address.state}`,
          );
        }

        groups.push({vendorId, subtotal, deliveryFee:delivery.fee, items});
      }

      const deliveryTotal = groups.reduce((sum,g)=>sum + g.deliveryFee,0);

      const order = await tx.order.create({
        data:{
          buyerId,
          itemsTotal,
          deliveryTotal,
          total:itemsTotal + deliveryTotal,
          shippingAddressId:address.id,
          // a frozen copy: the address row can be edited or deleted later and
          // this order still shows where it actually went
          shippingSnapshot:{
            label:address.label,
            line1:address.line1,
            line2:address.line2,
            city:address.city,
            state:address.state,
            postalCode:address.postalCode,
            country:address.country,
            phone:address.phone,
          },
        },
      });

      // OrderItem belongs to both the Order and the VendorOrder, so it cannot be
      // nested-created under either alone - the row needs both foreign keys.
      for(const group of groups){
        const vendorOrder = await tx.vendorOrder.create({
          data:{
            orderId:order.id,
            vendorId:group.vendorId,
            subtotal:group.subtotal,
            deliveryFee:group.deliveryFee,
          },
        });

        await tx.orderItem.createMany({
          data:group.items.map((item)=>({
            ...item,
            orderId:order.id,
            vendorOrderId:vendorOrder.id,
          })),
        });
      }

      await tx.cartItem.deleteMany({ where: {cartId:cart.id}});

      return tx.order.findUniqueOrThrow({
        where:{id:order.id},
        include:{items:true, vendorOrders:{include:{items:true}}},
      });
    });
  }

  findAllForBuyer(buyerId:string) {
    return this.prisma.order.findMany({
      where:{buyerId},
      include:{items:true, vendorOrders:{include:{items:true}}},
      orderBy:{createdAt:'desc'}});
  }

   findAllForVendor(vendorId:string, status?:VendorOrderStatus){
    return this.prisma.vendorOrder.findMany({
      where:{vendorId, ...(status?{status}:{})},
      include:{
        items:true,
        order:{select:{id:true, status:true, createdAt:true, shippingSnapshot:true}},
      },
      orderBy:{createdAt:'desc'}});
  }

  async findVendorOrder(id:string){
    const vendorOrder = await this.prisma.vendorOrder.findUnique({
      where:{id},
      include:{
        items:true,
        order:{select:{id:true, status:true, createdAt:true, shippingSnapshot:true}},
      },
    });
    if(!vendorOrder) throw new NotFoundException(`Vendor order with ID ${id} not found`);
    return vendorOrder;
  }

  private static readonly VENDOR_ORDER_NEXT:Record<VendorOrderStatus, VendorOrderStatus[]> = {
    PENDING:['ACCEPTED','CANCELLED'],
    ACCEPTED:['SHIPPED','CANCELLED'],
    SHIPPED:['DELIVERED'],
    DELIVERED:[],
    CANCELLED:[],
  };

  async updateVendorOrderStatus(id:string, status:VendorOrderStatus){
    const vendorOrder = await this.findVendorOrder(id);

    const allowed = OrdersService.VENDOR_ORDER_NEXT[vendorOrder.status];
    if(!allowed.includes(status)){
      throw new ConflictException(
        allowed.length
          ? `A ${vendorOrder.status} vendor order can only move to ${allowed.join(' or ')}`
          : `A ${vendorOrder.status} vendor order is final`,
      );
    }

    return this.prisma.$transaction(async (tx)=>{
      const updated = await tx.vendorOrder.update({
        where:{id},
        data:{status},
        include:{items:true},
      });

      const siblings = await tx.vendorOrder.findMany({
        where:{orderId:vendorOrder.orderId},
        select:{status:true},
      });

      const live = siblings.filter((sibling)=>sibling.status !== 'CANCELLED');

      if(live.length === 0){
        await tx.order.update({
          where:{id:vendorOrder.orderId},
          data:{status:'CANCELLED'},
        });
      } else if(live.every((sibling)=>sibling.status === 'DELIVERED')){
        await tx.order.update({
          where:{id:vendorOrder.orderId},
          data:{status:'DELIVERED'},
        });
      } else if(live.every((sibling)=>sibling.status === 'SHIPPED' || sibling.status === 'DELIVERED')){
        await tx.order.update({
          where:{id:vendorOrder.orderId},
          data:{status:'SHIPPED'},
        });
      }

      return updated;
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where:{id},
      include:{items:true, vendorOrders:{include:{items:true}}},
    })
    if(!order)throw new NotFoundException(`Order with ID ${id} not found`);
    return order;
  }

  async updateStatus(id: string, updateOrderStatusDto: UpdateOrderStatusDto) {
    await this.findOne(id);
    if(updateOrderStatusDto.status === 'CANCELLED'){
      throw new BadRequestException('Use the cancel endpoint to cancel an order')
    }
    return this.prisma.order.update({
      where:{id},
      data:{
        ...updateOrderStatusDto
      }
    })
  }

  async cancel(id:string){
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where:{id},
        include: {items:true},
      });
      if(!order) throw new NotFoundException(`Order with ID ${id} not found`);
      if(order.status !== 'PENDING'){
        throw new ConflictException( `Order cannot be cancelled once it is ${order.status}`)
      }

      for (const item of order.items){
        if(item.variantId){
          await tx.productVariant.update({
            where:{id:item.variantId},
            data:{stock:{increment:item.quantity}},
          })
        } else {
          await tx.product.update({
            where:{id:item.productId},
            data:{stock:{increment:item.quantity}},
          })
        }
      }

      await tx.vendorOrder.updateMany({
        where:{orderId:id},
        data:{status:'CANCELLED'},
      });

      return tx.order.update({
        where:{id},
        data:{status:'CANCELLED'},
        include:{items:true, vendorOrders:true},
      })
    })
  }

}
