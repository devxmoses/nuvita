import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateVariantDto {
    @ApiProperty({ example: '25kg', minLength: 1, maxLength: 60 })
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    name!: string;

    @ApiProperty({ example: 150000, description: 'Price in minor units. Overrides the product price.' })
    @IsInt()
    @Min(0)
    price!: number;

    @ApiPropertyOptional({ example: 40, default: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    stock?: number;

    @ApiPropertyOptional({ example: 'LM-25KG', description: 'Must be unique across all variants' })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    sku?: string;
}
