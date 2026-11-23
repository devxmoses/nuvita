import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('addresses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @ApiOperation({ summary: 'List your saved addresses, default first' })
  @Get()
  findAll(@Request() req) {
    return this.addressesService.findAllForUser(req.user.id);
  }

  @ApiOperation({ summary: 'Save a new address' })
  @ApiResponse({ status: 201, description: 'Address created' })
  @Post()
  create(@Request() req, @Body() createAddressDto: CreateAddressDto) {
    return this.addressesService.create(req.user.id, createAddressDto);
  }

  @ApiOperation({ summary: 'Get one of your addresses' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'Not found, or not yours' })
  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.addressesService.findOneForUser(req.user.id, id);
  }

  @ApiOperation({ summary: 'Update one of your addresses' })
  @ApiParam({ name: 'id' })
  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() updateAddressDto: UpdateAddressDto) {
    return this.addressesService.update(req.user.id, id, updateAddressDto);
  }

  @ApiOperation({ summary: 'Delete one of your addresses' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.addressesService.remove(req.user.id, id);
  }
}
