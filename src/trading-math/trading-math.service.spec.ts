import { Test, TestingModule } from '@nestjs/testing';
import { TradingMathService } from './trading-math.service';

describe('TradingMathService', () => {
  let service: TradingMathService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TradingMathService],
    }).compile();

    service = module.get<TradingMathService>(TradingMathService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
