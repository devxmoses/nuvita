import { IsString, IsInt, Min, IsOptional } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddCartItemDto {
    @ApiProperty({ example: 'clx1a2b3c4d5e6f7g8h9i0j1' })
    @IsString()
    productId!: string;

    @ApiPropertyOptional({
        example: 'clxvar000000000000000000',
        description:
            'Required when the product has variants. Omit for a product with none.',
    })
    @IsOptional()
    @IsString()
    variantId?: string;

    @ApiProperty({ example: 2, minimum: 1, description: 'Added to any existing quantity for this product' })
    @IsInt()
    @Min(1)
    quantity!: number;
}
