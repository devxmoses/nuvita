import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VendorOrderOwnerGuard implements CanActivate {
    constructor(private readonly prisma:PrismaService){}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if(!user) return false;

        const vendorOrderId = request.params.vendorOrderId;

        const vendorOrder = await this.prisma.vendorOrder.findUnique({
            where:{id:vendorOrderId},
            select:{vendor:{select:{ownerId:true}}},
        });
        if(!vendorOrder){
            throw new NotFoundException(`Vendor order with ID ${vendorOrderId} not found`);
        }

        if(user.isAdmin === true) return true;
        if(vendorOrder.vendor.ownerId === user.id) return true;

        throw new ForbiddenException('That vendor order belongs to another vendor');
    }
}
