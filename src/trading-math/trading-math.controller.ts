import { Controller, Get, Body } from '@nestjs/common';
import { TradingMathService } from './trading-math.service';

@Controller('trading-math')
export class TradingMathController {
    constructor(private readonly tradingMathService: TradingMathService) { }

    @Get('calculate-trading-thresholds')
    calculateTradingThresholds(@Body() body: any) {
        return this.tradingMathService.calculateTradingThresholds(body.buyFee, body.sellFee, body.ataCreationFee, body.tokenPrice, body.quantity, body.targetPricePercent, body.stoplossPricePercent, body.defensePricePercent);
    }
}
