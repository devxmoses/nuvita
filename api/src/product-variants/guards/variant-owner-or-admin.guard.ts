import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VariantOwnerOrAdminGuard implements CanActivate {
    constructor(private readonly prisma:PrismaService){}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if(!user) return false;

        const variantId = request.params.variantId;

        const variant = await this.prisma.productVariant.findUnique({
            where:{id:variantId},
            select:{product:{select:{vendor:{select:{ownerId:true}}}}},
        });
        if(!variant) throw new NotFoundException(`Variant with ID ${variantId} not found`);

        // isAdmin is read as a positive grant, never as the absence of a denial
        if(user.isAdmin === true) return true;
        if(variant.product.vendor.ownerId === user.id) return true;

        throw new ForbiddenException('You do not own this product');
    }
}
