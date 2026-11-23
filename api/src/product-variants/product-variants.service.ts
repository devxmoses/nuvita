import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Injectable()
export class ProductVariantsService {
    constructor(private readonly prisma:PrismaService){}

    async findAllForProduct(productId:string){
        const product = await this.prisma.product.findUnique({where:{id:productId}});
        if(!product) throw new NotFoundException(`Product with ID ${productId} not found`);

        return this.prisma.productVariant.findMany({
            where:{productId},
            orderBy:{price:'asc'},
        });
    }

    async findOne(id:string){
        const variant = await this.prisma.productVariant.findUnique({where:{id}});
        if(!variant) throw new NotFoundException(`Variant with ID ${id} not found`);
        return variant;
    }

    async create(productId:string, createVariantDto:CreateVariantDto){
        const product = await this.prisma.product.findUnique({where:{id:productId}});
        if(!product) throw new NotFoundException(`Product with ID ${productId} not found`);

        // @@unique([productId, name]) and @unique(sku) make the duplicate cases a
        // P2002, which the global filter maps to 409 - no try/catch needed here
        return this.prisma.productVariant.create({
            data:{
                productId,
                name:createVariantDto.name.trim(),
                price:createVariantDto.price,
                stock:createVariantDto.stock ?? 0,
                sku:createVariantDto.sku?.trim() || null,
            },
        });
    }

    async update(id:string, updateVariantDto:UpdateVariantDto){
        await this.findOne(id);

        const {name, sku, ...rest} = updateVariantDto;
        return this.prisma.productVariant.update({
            where:{id},
            data:{
                ...rest,
                ...(name?{name:name.trim()}:{}),
                ...(sku !== undefined?{sku:sku?.trim() || null}:{}),
            },
        });
    }

    async remove(id:string){
        await this.findOne(id);

        const ordered = await this.prisma.orderItem.count({where:{variantId:id}});
        if(ordered){
            throw new ConflictException(
                `This variant appears on ${ordered} order item(s) and cannot be deleted. ` +
                `Set isActive to false to stop selling it.`,
            );
        }

        return this.prisma.productVariant.delete({where:{id}});
    }
}
