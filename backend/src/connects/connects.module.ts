import { Module } from '@nestjs/common';
import { BalancersModule } from '../balancers/balancers.module';
import { ConnectsController } from './connects.controller';
import { ConnectsService } from './connects.service';

@Module({
  imports: [BalancersModule],
  controllers: [ConnectsController],
  providers: [ConnectsService],
})
export class ConnectsModule {}
