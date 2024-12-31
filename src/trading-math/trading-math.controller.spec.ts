import { Test, TestingModule } from '@nestjs/testing';
import { TradingMathController } from './trading-math.controller';

describe('TradingMathController', () => {
  let controller: TradingMathController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TradingMathController],
    }).compile();

    controller = module.get<TradingMathController>(TradingMathController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
