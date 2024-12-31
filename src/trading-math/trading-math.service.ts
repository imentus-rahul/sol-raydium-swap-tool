import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

@Injectable()
export class TradingMathService {
    // Install Decimal.js using: npm install decimal.js

    calculateTradingThresholds(buyFee: number, sellFee: number, ataCreationFee: number, tokenPrice: number, quantity: number, targetPricePercent: number, stoplossPricePercent: number, defensePricePercent: number) {

        const amount = new Decimal(tokenPrice).mul(quantity);

        const buy2sell1ATAFee = new Decimal(buyFee).mul(2).plus(sellFee).plus(ataCreationFee);
        const buySellATAFee = new Decimal(buyFee).plus(sellFee).plus(ataCreationFee);

        const targetPrice = new Decimal(tokenPrice).mul(new Decimal(1).plus(new Decimal(targetPricePercent).div(100)));
        const stoplossPrice = new Decimal(tokenPrice).mul(new Decimal(1).minus(new Decimal(stoplossPricePercent).div(100)));
        const defensePrice = new Decimal(tokenPrice).mul(new Decimal(1).minus(new Decimal(defensePricePercent).div(100))); // price at which defense will be triggered

        // defenseMultiplier is the times of tokens that will be available as balance after defense is triggered
        const defenseMultiplier = new Decimal(2);

        // post defense hit and purchase of new tokens, below will be the net cost price of total tokens
        const postDefenseTokenPrice = (new Decimal(tokenPrice).plus(new Decimal(defensePrice))).div(defenseMultiplier);
        const postDefenseQuantity = new Decimal(quantity).mul(defenseMultiplier);
        const postDefenseAmount = postDefenseTokenPrice.mul(postDefenseQuantity);

        const amountWithFees = new Decimal(amount).plus(buySellATAFee);
        const currentPriceWithFees = new Decimal(amountWithFees).div(quantity);

        const targetAmountWithFees = (amount.mul(new Decimal(1).plus(new Decimal(targetPricePercent).div(100)))).plus(buySellATAFee);
        const targetPriceWithFees = targetAmountWithFees.div(quantity);

        const stoplossAmountWithFees = new Decimal(quantity).mul(defenseMultiplier).mul(stoplossPrice).plus(buy2sell1ATAFee);
        const stoplossPriceWithFees = stoplossAmountWithFees.div(new Decimal(quantity).mul(defenseMultiplier));

        const postDefenseAmountWithFees = postDefenseAmount.plus(buy2sell1ATAFee);
        const postDefensePriceWithFees = postDefenseAmountWithFees.div(new Decimal(quantity).mul(defenseMultiplier));

        // const defenseTargetAmountWithFees = postDefenseAmountWithFees;
        // const defenseTargetPriceWithFees = postDefensePriceWithFees;


        return {
            "Token Price": tokenPrice,
            "Quantity": quantity,
            "Amount": amount,
            "targetPricePercent": targetPricePercent,
            "stoplossPricePercent": stoplossPricePercent,
            "defensePricePercent": defensePricePercent,
            "Target Price": targetPrice,
            "Stoploss Price": stoplossPrice,
            "Defense Price": defensePrice,
            "Post Hitting Defense Token Price == Defense Target Price (No P/L)": postDefenseTokenPrice,
            "Post Hitting Defense Quantity": postDefenseQuantity,
            "Post Hitting Defense Amount == Defense Target Amount (No P/L)": postDefenseAmount,
            "Amount with buy + sell taxes": amountWithFees,
            "Current Price with buy + sell taxes": currentPriceWithFees,
            "Target Amount with buy + sell taxes Without Hitting Defense": targetAmountWithFees,
            "Target Price with buy + sell taxes Without Hitting Defense": targetPriceWithFees,
            "Stoploss Amount with buy + sell taxes Post Hitting Defense": stoplossAmountWithFees,
            "Stoploss Price with buy + sell taxes Post Hitting Defense": stoplossPriceWithFees,
            "Post Hitting Defense Amount with buy + sell taxes == Defense Target Amount with buy + sell taxes (No P/L)": postDefenseAmountWithFees,
            "Post Hitting Defense Price with buy + sell taxes == Defense Target Price with buy + sell taxes (No P/L)": postDefensePriceWithFees
        };
    }

    // // Example Input
    // const input = {
    //     buyFee: 0.00085,
    //     sellFee: 0.00085,
    //     ataCreationFee: 0.00203928,
    //     tokenPrice: 100,
    //     quantity: 10,
    //     amount: 1000,
    //     targetPricePercent: 20.00,
    //     stoplossPricePercent: 20.00,
    //     defensePricePercent: 10.00
    // };

    // console.log(JSON.stringify(calculateTradingThresholds(input), null, 2));

}
