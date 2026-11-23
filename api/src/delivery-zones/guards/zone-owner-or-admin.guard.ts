import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ZoneOwnerOrAdminGuard implements CanActivate {
    constructor(private readonly prisma:PrismaService){}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if(!user) return false;

        const zoneId = request.params.zoneId;

        const zone = await this.prisma.deliveryZone.findUnique({
            where:{id:zoneId},
            select:{vendor:{select:{ownerId:true}}},
        });
        if(!zone) throw new NotFoundException(`Delivery zone with ID ${zoneId} not found`);

        if(user.isAdmin === true) return true;
        if(zone.vendor.ownerId === user.id) return true;

        throw new ForbiddenException('You can only manage your own delivery zones');
    }
}
