import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateVariantDto } from './create-variant.dto';

export class UpdateVariantDto extends PartialType(CreateVariantDto) {
    @ApiPropertyOptional({ description: 'Hide this variant without deleting it' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
