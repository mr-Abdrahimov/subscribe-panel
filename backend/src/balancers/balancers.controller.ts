import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BalancersService } from './balancers.service';
import { CreateBalancerDto } from './dto/create-balancer.dto';
import { UpdateBalancerDto } from './dto/update-balancer.dto';

@ApiTags('Балансировщики')
@Controller('balancers')
export class BalancersController {
  constructor(private readonly balancersService: BalancersService) {}

  @Get()
  @ApiOperation({ summary: 'Получить список всех балансировщиков' })
  findAll() {
    return this.balancersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить балансировщик по ID' })
  findOne(@Param('id') id: string) {
    return this.balancersService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать новый балансировщик' })
  create(@Body() dto: CreateBalancerDto) {
    return this.balancersService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить балансировщик' })
  update(@Param('id') id: string, @Body() dto: UpdateBalancerDto) {
    return this.balancersService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить балансировщик' })
  remove(@Param('id') id: string) {
    return this.balancersService.remove(id);
  }
}
