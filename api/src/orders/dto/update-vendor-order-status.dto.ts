import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { VendorOrderStatus } from '../../../generated/prisma/enums';

export class UpdateVendorOrderStatusDto {
    @ApiProperty({
        enum: VendorOrderStatus,
        example: VendorOrderStatus.ACCEPTED,
        description:
            'Forward only: PENDING to ACCEPTED or CANCELLED, ACCEPTED to SHIPPED ' +
            'or CANCELLED, SHIPPED to DELIVERED. DELIVERED and CANCELLED are final.',
    })
    @IsEnum(VendorOrderStatus)
    status!: VendorOrderStatus;
}
