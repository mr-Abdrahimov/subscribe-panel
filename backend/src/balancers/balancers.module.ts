import { Module } from '@nestjs/common';
import { BalancersController } from './balancers.controller';
import { BalancersService } from './balancers.service';

@Module({
  controllers: [BalancersController],
  providers: [BalancersService],
})
export class BalancersModule {}
