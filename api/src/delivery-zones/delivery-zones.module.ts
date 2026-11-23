import { Module } from '@nestjs/common';
import { DeliveryZonesService } from './delivery-zones.service';
import { DeliveryZonesController } from './delivery-zones.controller';

@Module({
  controllers: [DeliveryZonesController],
  providers: [DeliveryZonesService],
  exports: [DeliveryZonesService],// checkout resolves a fee per vendor, so OrdersModule imports this
})
export class DeliveryZonesModule {}
