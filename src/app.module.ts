import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SolanaService } from './solana/solana.service';
import { SolanaModule } from './solana/solana.module';
import { SolanaController } from './solana/solana.controller';
import { RaydiumSwapService } from './raydium-swap/raydium-swap.service';
import { TradingMathService } from './trading-math/trading-math.service';
import { TradingMathController } from './trading-math/trading-math.controller';

@Module({
  imports: [SolanaModule],
  controllers: [AppController, SolanaController, TradingMathController],
  providers: [AppService, SolanaService, RaydiumSwapService, TradingMathService],
})
export class AppModule {}
