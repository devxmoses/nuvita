import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DeliveryZonesService } from './delivery-zones.service';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VendorOwnerOrAdminGuard } from '../vendors/guards/vendor-owner-or-admin.guard';
import { ZoneOwnerOrAdminGuard } from './guards/zone-owner-or-admin.guard';

@ApiTags('delivery zones')
@Controller()
export class DeliveryZonesController {
  constructor(private readonly zonesService: DeliveryZonesService) {}

  @ApiOperation({ summary: 'List a vendor delivery zones' })
  @ApiParam({ name: 'id', description: 'Vendor id' })
  @Get('vendors/:id/delivery-zones')
  findAll(@Param('id') vendorId: string) {
    return this.zonesService.findAllForVendor(vendorId);
  }

  @ApiOperation({
    summary: 'Ask what a vendor would charge to deliver somewhere',
    description:
      'Resolves the most specific matching zone. Returns null when the vendor ' +
      'does not deliver to that place at all.',
  })
  @ApiParam({ name: 'id', description: 'Vendor id' })
  @ApiQuery({ name: 'country', required: false, example: 'NG' })
  @ApiQuery({ name: 'state', required: true, example: 'Oyo' })
  @ApiQuery({ name: 'city', required: true, example: 'Ibadan' })
  @ApiQuery({ name: 'subtotal', required: false, example: 250000 })
  @Get('vendors/:id/delivery-quote')
  quote(
    @Param('id') vendorId: string,
    @Query('state') state: string,
    @Query('city') city: string,
    @Query('country') country?: string,
    @Query('subtotal') subtotal?: string,
  ) {
    return this.zonesService.resolve(
      vendorId,
      { country: country ?? 'NG', state: state ?? '', city: city ?? '' },
      Number(subtotal ?? 0) || 0,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a delivery zone to a vendor you own' })
  @ApiParam({ name: 'id', description: 'Vendor id' })
  @ApiResponse({ status: 201, description: 'Zone created' })
  @ApiResponse({ status: 403, description: 'You can only modify your own vendor' })
  @ApiResponse({ status: 409, description: 'You already have a zone covering that place' })
  @UseGuards(JwtAuthGuard, VendorOwnerOrAdminGuard)
  @Post('vendors/:id/delivery-zones')
  create(@Param('id') vendorId: string, @Body() createDeliveryZoneDto: CreateDeliveryZoneDto) {
    return this.zonesService.create(vendorId, createDeliveryZoneDto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a delivery zone you own' })
  @ApiParam({ name: 'zoneId' })
  @UseGuards(JwtAuthGuard, ZoneOwnerOrAdminGuard)
  @Patch('delivery-zones/:zoneId')
  update(@Param('zoneId') zoneId: string, @Body() updateDeliveryZoneDto: UpdateDeliveryZoneDto) {
    return this.zonesService.update(zoneId, updateDeliveryZoneDto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a delivery zone you own' })
  @ApiParam({ name: 'zoneId' })
  @UseGuards(JwtAuthGuard, ZoneOwnerOrAdminGuard)
  @Delete('delivery-zones/:zoneId')
  remove(@Param('zoneId') zoneId: string) {
    return this.zonesService.remove(zoneId);
  }
}
