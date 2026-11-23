import {Request, Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VendorOwnerOrAdminGuard } from './guards/vendor-owner-or-admin.guard';
import { FindVendorsQueryDto } from './dto/find-vendors-query.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';


@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a vendor storefront (also grants you the vendor role)' })
  @ApiResponse({ status: 201, description: 'Vendor created' })
  @ApiResponse({ status: 409, description: 'A vendor with that slug already exists' })
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Request() req, @Body() createVendorDto: CreateVendorDto) {
    return this.vendorsService.create(req.user.id,createVendorDto);
  }

  @ApiOperation({ summary: 'List vendors, paginated' })
  @ApiResponse({ status: 200, description: 'A page of vendors plus pagination meta' })
  @Get()
  findAll(@Query() query:FindVendorsQueryDto) {
    return this.vendorsService.findAll(query);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vendors awaiting approval (admin only)' })
  @ApiResponse({ status: 403, description: 'Admins only' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Get('pending')
  findPending() {
    return this.vendorsService.findPending();
  }



  @ApiOperation({ summary: 'Get a single vendor by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'The vendor' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vendorsService.findOne(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a vendor, making it and its products public (admin only)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'The approved vendor' })
  @ApiResponse({ status: 403, description: 'Admins only' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.vendorsService.approve(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a vendor approval, hiding it from the catalogue (admin only)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Admins only' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Patch(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.vendorsService.revokeApproval(id);
  }


  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a vendor you own' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Vendor updated' })
  @ApiResponse({ status: 403, description: 'You can only modify your own vendor' })
  @UseGuards(JwtAuthGuard,VendorOwnerOrAdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateVendorDto: UpdateVendorDto) {
    return this.vendorsService.update(id, updateVendorDto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a vendor you own' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Vendor deleted' })
  @ApiResponse({ status: 403, description: 'You can only modify your own vendor' })
  @UseGuards(JwtAuthGuard, VendorOwnerOrAdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vendorsService.remove(id);
  }
}
