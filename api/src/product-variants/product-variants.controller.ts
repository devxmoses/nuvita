import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductVariantsService } from './product-variants.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProductOwnerOrAdminGuard } from '../products/guards/product-owner-or-admin.guard';
import { VariantOwnerOrAdminGuard } from './guards/variant-owner-or-admin.guard';

@ApiTags('product variants')
@Controller()
export class ProductVariantsController {
  constructor(private readonly variantsService: ProductVariantsService) {}

  @ApiOperation({ summary: 'List a product variants, cheapest first' })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @Get('products/:id/variants')
  findAll(@Param('id') productId: string) {
    return this.variantsService.findAllForProduct(productId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a variant to a product you own' })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiResponse({ status: 201, description: 'Variant created' })
  @ApiResponse({ status: 403, description: 'You do not own this product' })
  @ApiResponse({ status: 409, description: 'That variant name or SKU already exists' })
  @UseGuards(JwtAuthGuard, ProductOwnerOrAdminGuard)
  @Post('products/:id/variants')
  create(@Param('id') productId: string, @Body() createVariantDto: CreateVariantDto) {
    return this.variantsService.create(productId, createVariantDto);
  }

  @ApiOperation({ summary: 'Get a single variant' })
  @ApiParam({ name: 'variantId' })
  @Get('variants/:variantId')
  findOne(@Param('variantId') variantId: string) {
    return this.variantsService.findOne(variantId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a variant of a product you own' })
  @ApiParam({ name: 'variantId' })
  @ApiResponse({ status: 403, description: 'You do not own this product' })
  @UseGuards(JwtAuthGuard, VariantOwnerOrAdminGuard)
  @Patch('variants/:variantId')
  update(@Param('variantId') variantId: string, @Body() updateVariantDto: UpdateVariantDto) {
    return this.variantsService.update(variantId, updateVariantDto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a variant that has never been ordered' })
  @ApiParam({ name: 'variantId' })
  @ApiResponse({ status: 409, description: 'Already ordered - deactivate it instead' })
  @UseGuards(JwtAuthGuard, VariantOwnerOrAdminGuard)
  @Delete('variants/:variantId')
  remove(@Param('variantId') variantId: string) {
    return this.variantsService.remove(variantId);
  }
}
