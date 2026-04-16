import { Module } from '@nestjs/common';
import { BalancersController } from './balancers.controller';
import { BalancersService } from './balancers.service';

@Module({
  controllers: [BalancersController],
  providers: [BalancersService],
  exports: [BalancersService],
})
export class BalancersModule {}
