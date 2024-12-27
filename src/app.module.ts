import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SolanaService } from './solana/solana.service';
import { SolanaModule } from './solana/solana.module';
import { SolanaController } from './solana/solana.controller';
import { RaydiumSwapService } from './raydium-swap/raydium-swap.service';

@Module({
  imports: [SolanaModule],
  controllers: [AppController, SolanaController],
  providers: [AppService, SolanaService, RaydiumSwapService],
})
export class AppModule {}
