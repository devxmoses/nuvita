import { Query,  Controller, Get, Post, Body, Patch, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateVendorOrderStatusDto } from './dto/update-vendor-order-status.dto';
import { VendorOrderOwnerGuard } from './guards/vendor-order-owner.guard';
import { VendorOwnerToOrderGuard } from './guards/vendor-owner-to-order.guard';
import { VendorOrderStatus } from '../../generated/prisma/enums';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrderOwnerOrAdminGuard } from './guards/order-owner-or-admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/enums/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';


@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiOperation({
    summary: 'Check out: turn your current cart into an order',
    description:
      'Splits the cart into one VendorOrder per vendor, resolves each vendor ' +
      'delivery fee for the chosen address, and freezes a copy of that address.',
  })
  @ApiResponse({ status: 201, description: 'Order created, stock decremented, cart cleared' })
  @ApiResponse({ status: 400, description: 'Cart empty, product unavailable, or a vendor does not deliver there' })
  @ApiResponse({ status: 404, description: 'That address is not one of yours' })
  @ApiResponse({ status: 409, description: 'Not enough stock for one of the products' })
  @Post()
  create(@Request() req, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(req.user.id, createOrderDto);
  }

  @ApiOperation({ summary: 'List your own orders' })
  @ApiResponse({ status: 200, description: 'List of your orders' })
  @Get()
  findAllForBuyer(@Request() req) {
    return this.ordersService.findAllForBuyer(req.user.id);
  }

  @ApiOperation({ summary: 'List orders for one of your vendors' })
  @ApiParam({ name: 'vendorId' })
  @ApiResponse({ status: 403, description: 'You can only view orders for your own vendor' })
  @UseGuards(VendorOwnerToOrderGuard)
  @Get('vendor/:vendorId')
  findAllforVendor(
    @Param('vendorId') vendorId:string,
    @Query('status') status?:VendorOrderStatus,
  ){
    return this.ordersService.findAllForVendor(vendorId, status);
  }

  @ApiOperation({ summary: 'One of your vendor orders, with its items and the delivery address' })
  @ApiParam({ name: 'vendorOrderId' })
  @ApiResponse({ status: 403, description: 'That vendor order belongs to another vendor' })
  @UseGuards(VendorOrderOwnerGuard)
  @Get('vendor-orders/:vendorOrderId')
  findVendorOrder(@Param('vendorOrderId') vendorOrderId:string){
    return this.ordersService.findVendorOrder(vendorOrderId);
  }

  @ApiOperation({ summary: 'Advance one of your vendor orders' })
  @ApiParam({ name: 'vendorOrderId' })
  @ApiResponse({ status: 200, description: 'Updated, and the parent order status recomputed' })
  @ApiResponse({ status: 409, description: 'That transition is not allowed from the current status' })
  @UseGuards(VendorOrderOwnerGuard)
  @Patch('vendor-orders/:vendorOrderId/status')
  updateVendorOrderStatus(
    @Param('vendorOrderId') vendorOrderId:string,
    @Body() updateVendorOrderStatusDto:UpdateVendorOrderStatusDto,
  ){
    return this.ordersService.updateVendorOrderStatus(
      vendorOrderId,
      updateVendorOrderStatusDto.status,
    );
  }


  @ApiOperation({ summary: 'Get a single order by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'The order' })
  @ApiResponse({ status: 403, description: 'You can only view your own orders'})
  @ApiResponse({ status: 404, description: 'Order not found' })
  @UseGuards(OrderOwnerOrAdminGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @ApiOperation({ summary: 'Update an order status (admin only)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Order status updated' })
  @ApiResponse({ status: 400, description: 'Use the cancel endpoint to cancel an order' })
  @ApiResponse({ status: 403, description: 'Admins only' })
  @UseGuards(RolesGuard)
  @Roles(Role.Admin)
  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() updateOrderStatusDto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(id, updateOrderStatusDto);
  }

  @ApiOperation({ summary: 'Cancel your own pending order (restocks the items)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Order cancelled and stock restored' })
  @ApiResponse({ status: 403, description: 'You can only cancel your own order' })
  @ApiResponse({ status: 409, description: 'Order has already moved past PENDING' })
  @UseGuards(OrderOwnerOrAdminGuard)
  @Patch(':id/cancel')
  cancel(@Param('id') id:string){
    return this.ordersService.cancel(id);
  }

}
