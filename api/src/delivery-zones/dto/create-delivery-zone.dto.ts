import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, MaxLength, Min, MinLength } from 'class-validator';

export class CreateDeliveryZoneDto {
    @ApiProperty({ example: 'Ibadan metro' })
    @IsString()
    @MinLength(2)
    @MaxLength(60)
    name!: string;

    @ApiPropertyOptional({ example: 'NG', default: 'NG', description: 'ISO 3166-1 alpha-2' })
    @IsOptional()
    @IsString()
    @Length(2, 2)
    country?: string;

    @ApiPropertyOptional({ example: 'Oyo', description: 'Omit to cover the whole country' })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    state?: string;

    @ApiPropertyOptional({ example: 'Ibadan', description: 'Omit to cover the whole state' })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    city?: string;

    @ApiProperty({ example: 150000, description: 'Delivery fee in minor units' })
    @IsInt()
    @Min(0)
    fee!: number;

    @ApiPropertyOptional({
        example: 5000000,
        description: 'Order subtotal at or above which the fee is waived. Omit for never.',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    freeAbove?: number;

    @ApiPropertyOptional({ description: 'Suspend this zone without deleting it' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
