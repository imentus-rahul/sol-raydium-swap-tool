import { Test, TestingModule } from '@nestjs/testing';
import { RaydiumSwapService } from './raydium-swap.service';

describe('RaydiumSwapService', () => {
  let service: RaydiumSwapService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RaydiumSwapService],
    }).compile();

    service = module.get<RaydiumSwapService>(RaydiumSwapService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
