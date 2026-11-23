import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderOwnerOrAdminGuard } from './guards/order-owner-or-admin.guard';
import { VendorOwnerToOrderGuard } from './guards/vendor-owner-to-order.guard';
import { VendorOrderOwnerGuard } from './guards/vendor-order-owner.guard';
import { DeliveryZonesModule } from '../delivery-zones/delivery-zones.module';

@Module({
  // checkout resolves a delivery fee per vendor
  imports: [DeliveryZonesModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderOwnerOrAdminGuard,
    VendorOwnerToOrderGuard,
    VendorOrderOwnerGuard,
  ],
})
export class OrdersModule {}
