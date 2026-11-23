import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class CreateAddressDto {
    @ApiPropertyOptional({ example: 'Farm', description: 'Your own label for this address' })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    label?: string;

    @ApiProperty({ example: '12 Agodi Road' })
    @IsString()
    @MinLength(3)
    @MaxLength(120)
    line1!: string;

    @ApiPropertyOptional({ example: 'Opposite the grain store' })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    line2?: string;

    @ApiProperty({ example: 'Ibadan' })
    @IsString()
    @MinLength(2)
    @MaxLength(60)
    city!: string;

    @ApiProperty({ example: 'Oyo' })
    @IsString()
    @MinLength(2)
    @MaxLength(60)
    state!: string;

    @ApiPropertyOptional({ example: '200223' })
    @IsOptional()
    @IsString()
    @MaxLength(20)
    postalCode?: string;

    @ApiPropertyOptional({ example: 'NG', default: 'NG', description: 'ISO 3166-1 alpha-2' })
    @IsOptional()
    @IsString()
    @Length(2, 2)
    country?: string;

    @ApiPropertyOptional({ example: '+2348012345678' })
    @IsOptional()
    @IsString()
    @MaxLength(20)
    phone?: string;

    @ApiPropertyOptional({ description: 'Make this your default delivery address' })
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}
