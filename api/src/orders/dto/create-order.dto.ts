import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateOrderDto {
    @ApiProperty({
        example: 'clxaddr00000000000000000',
        description: 'One of your saved addresses. Every vendor must deliver there.',
    })
    @IsString()
    shippingAddressId!: string;
}
