import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import {  UpdateCartItemDto } from './dto/update-cart-item.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CartsService {
  constructor(private readonly prisma:PrismaService){}

  async getCart(userId:string){
    const cart = await this.prisma.cart.findUnique({
      where:{userId},
      include:{items:{include:{product:true, variant:true}}},
    });
    return cart ?? {userId,items:[]};
  }

  private async resolveLine(productId:string, variantId?:string){
    const product = await this.prisma.product.findUnique({
      where:{id:productId},
      include:{variants:{where:{isActive:true}, select:{id:true}}},
    });
    if(!product) throw new NotFoundException(`Product with ID ${productId} not found`);
    if(!product.isActive) throw new BadRequestException(`Product "${product.name}" is not available`);

    if(!variantId){
      if(product.variants.length){
        throw new BadRequestException(
          `Product "${product.name}" is sold by variant; choose one of its ${product.variants.length} options`,
        );
      }
      return {product, variant:null};
    }

    const variant = await this.prisma.productVariant.findUnique({where:{id:variantId}});
    if(!variant) throw new NotFoundException(`Variant with ID ${variantId} not found`);
   if(variant.productId !== product.id){
      throw new BadRequestException('That variant does not belong to that product');
    }
    if(!variant.isActive){
      throw new BadRequestException(`Variant "${variant.name}" is not available`);
    }

    return {product, variant};
  }

  async addItem(userId:string,addCartItemDto:AddCartItemDto){
    const {product, variant} = await this.resolveLine(
      addCartItemDto.productId,
      addCartItemDto.variantId,
    );

    const cart = await this.prisma.cart.upsert({
      where:{userId},
      update:{},
      create:{userId},
    });

    const existing = await this.prisma.cartItem.findFirst({
      where:{cartId:cart.id, productId:product.id, variantId:variant?.id ?? null},
    });

    if(existing){
      return this.prisma.cartItem.update({
        where:{id:existing.id},
        data:{quantity:{increment:addCartItemDto.quantity}},
        include:{product:true, variant:true},
      });
    }

    return this.prisma.cartItem.create({
      data:{
        cartId:cart.id,
        productId:product.id,
        variantId:variant?.id ?? null,
        quantity:addCartItemDto.quantity,
      },
      include:{product:true, variant:true},
    });
  }

  private async findOwnItem(userId:string, itemId:string){
    const cart = await this.prisma.cart.findUnique({where:{userId}});
    if(!cart) throw new NotFoundException(`Your cart is empty`);

    const item = await this.prisma.cartItem.findFirst({
      where:{id:itemId, cartId:cart.id},
    });
    if(!item) throw new NotFoundException(`Item ${itemId} is not in your cart`);

    return item;
  }

  async updateItem(userId:string, itemId:string, updateCartItemDto:UpdateCartItemDto){
    const item = await this.findOwnItem(userId, itemId);

    return this.prisma.cartItem.update({
      where:{id:item.id},
      data:{quantity:updateCartItemDto.quantity},
      include:{product:true, variant:true},
    });
  }

  async removeItem(userId:string, itemId:string){
    const item = await this.findOwnItem(userId, itemId);

    return this.prisma.cartItem.delete({where:{id:item.id}});
  }

  async clearCart(userId:string){
    const cart = await this.prisma.cart.findUnique({where:{userId}});
    if(!cart) return;
    await this.prisma.cartItem.deleteMany({where:{cartId:cart.id}});
  }
}
