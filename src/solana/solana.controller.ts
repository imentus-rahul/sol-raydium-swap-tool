import { Controller, Get, Param, Body } from '@nestjs/common';
import { SolanaService } from './solana.service';
import { RaydiumSwapService } from 'src/raydium-swap/raydium-swap.service';

@Controller('solana')
export class SolanaController {
  constructor(private readonly solanaService: SolanaService, private readonly raydiumSwapService: RaydiumSwapService) {}

  @Get('getRawAccountInfo/:publicKey')
  async getRawAccountInfo(@Param('publicKey') publicKey: string) {
    return this.solanaService.getAccountInfo(publicKey);
  }

  @Get('getBlockHeight')
  async getBlockHeight() {
    return this.solanaService.getBlockHeight();
  }

  @Get('getLatestBlockhash')
  async getLatestBlockhash() {
    return this.solanaService.getLatestBlockhash();
  }

  @Get('getRecentPriorityFee')
  async getRecentPriorityFee(@Body() body: { accountKeys: string[] }) {
    return this.solanaService.getRecentPriorityFee(body.accountKeys);
  }

  @Get('getComputeBudgetIxs')
  async getComputeBudgetIxs(@Body() body: { computeUnitPrice: number, computeUnitLimit: number }) {
    return this.solanaService.ix_getComputeBudgetIxs(body.computeUnitPrice, body.computeUnitLimit);
  }

  @Get('getParsedTransactionReceipt/:transactionHash')
  async getParsedTransactionReceipt(@Param('transactionHash') transactionHash: string) {
    return this.solanaService.getParsedTransactionReceipt(transactionHash);
  }

  @Get('getBothTransactionReceipt/:transactionHash')
  async getBothTransactionReceipt(@Param('transactionHash') transactionHash: string) {
    return this.solanaService.getBothTransactionReceipt(transactionHash);
  }

  @Get('signTx')
  async signTx(@Body() body: { transaction: string, arrayOfStringKeypairs: string[] }) {
    return this.solanaService.signTx(body.transaction, body.arrayOfStringKeypairs);
  }

  @Get('sendSignedTx')
  async sendSignedTx(@Body() body: { transaction: string }) {
    return this.solanaService.sendSignedTx(body.transaction);
  }

  @Get('signAndSendTx')
  async signAndSendTx(@Body() body: { transaction: string, arrayOfStringKeypairs: string[] }) {
    return this.solanaService.signAndSendTx(body.transaction, body.arrayOfStringKeypairs);
  }

  @Get('confirmTransaction/:transactionHash')
  async confirmTransaction(@Param('transactionHash') transactionHash: string) {
    return this.solanaService.confirmTransaction(transactionHash);
  }

  @Get('getSOLBalance/:accountToFetch')
  async getSOLBalance(@Param('accountToFetch') accountToFetch: string) {
    return this.solanaService.getSOLBalance(accountToFetch);
  }

  @Get('tx_transferSOL')
  async tx_transferSOL(@Body() body: { fromAddress: string, recipientAddress: string, amount: number }) {
    return this.solanaService.tx_transferSOL(body.fromAddress, body.recipientAddress, body.amount);
  }

  @Get('getPreAndPostSolanaBalance')
  async getPreAndPostSolanaBalance(@Body() body: { transactionHash: string, owner: string }) {
    return this.solanaService.getPreAndPostSolanaBalance(body.transactionHash, body.owner);
  }

  @Get('getTokenAccount')
  async getTokenAccount(@Body() body: { mintAddress: string, owner: string }) {
    return this.solanaService.getTokenAccount(body.mintAddress, body.owner);
  }

  @Get('ix_createTokenAccount')
  async ix_createTokenAccount(@Body() body: { mintAddress: string, owner: string }) {
    return this.solanaService.ix_createTokenAccount(body.mintAddress, body.owner);
  }

  @Get('ix_transferToken')
  async ix_transferToken(@Body() body: { mintAddress: string, owner: string, recipientAddress: string, amount: number }) {
    return this.solanaService.ix_transferToken(body.mintAddress, body.owner, body.recipientAddress, body.amount);
  }

  @Get('ix_syncNativeToken')
  async ix_syncNativeToken(@Body() body: { recipientAddress: string }) {
    return this.solanaService.ix_syncNativeToken(body.recipientAddress);
  }

  @Get('ix_unwrapSolCloseTokenAccount')
  async ix_unwrapSolCloseTokenAccount(@Body() body: { recipientAddress: string }) {
    return this.solanaService.ix_unwrapSolCloseTokenAccount(body.recipientAddress);
  }

  @Get('getAllTokenAccounts')
  async getAllTokenAccounts(@Body() body: { owner: string }) {
    return this.solanaService.getAllTokenAccounts(body.owner);
  }

  @Get('getPreAndPostTokenBalance')
  async getPreAndPostTokenBalance(@Body() body: { transactionHash: string, owner: string }) {
    return this.solanaService.getPreAndPostTokenBalance(body.transactionHash, body.owner);
  }

  @Get('getAllTokenAccountsWithRaydiumPrices')  
  async getAllTokenAccountsWithRaydiumPrices(@Body() body: { owner: string }) {
    return this.solanaService.getAllTokenAccountsWithRaydiumPrices(body.owner);
  }

  @Get('getInputAndOutputTokenQtyFromTxReceiptPostSwap')
  async getInputAndOutputTokenQtyFromTxReceiptPostSwap(@Body() body: { transactionHash: string, owner: string }) {
    return this.solanaService.getInputAndOutputTokenQtyFromTxReceiptPostSwap(body.transactionHash, body.owner);
  }

  @Get('getPoolKeysFromAmmId/:ammId')
  async getPoolKeysFromAmmId(@Param('ammId') ammId: string) {
    return this.raydiumSwapService.getPoolKeysFromAmmId(ammId);
  }

  @Get('getPoolInfoForTokens')
  async getPoolInfoForTokens(@Body() body: { ammId: string, mintA: string, mintB: string }) {
    return this.raydiumSwapService.findPoolInfoForTokens(body.ammId, body.mintA, body.mintB);
  }

  @Get('getSignedSwapTransaction')
  async getSignedSwapTransaction(@Body() body: { fromToken: string, toToken: string, ammId: string, amount: number, slippageX: number, maxLamports: number, useVersionedTransaction: boolean, fixedSide: 'in' | 'out'}) {
    return this.raydiumSwapService.getSwapTransaction(body.fromToken, body.toToken, body.ammId, body.amount, body.slippageX, body.maxLamports, body.useVersionedTransaction, body.fixedSide);
  }

  @Get('sendSignedSwapTransaction')
  async sendSignedSwapTransaction(@Body() body: { fromToken: string, toToken: string, ammId: string, amount: number, slippageX: number, maxLamports: number, useVersionedTransaction: boolean, fixedSide: 'in' | 'out', maxRetries: number }) {
    return this.raydiumSwapService.sendSignedSwapTransaction(body.fromToken, body.toToken, body.ammId, body.amount, body.slippageX, body.maxLamports, body.useVersionedTransaction, body.fixedSide, body.maxRetries);
  }

  @Get('simulateSignedSwapTransaction')
  async simulateSignedSwapTransaction(@Body() body: { fromToken: string, toToken: string, ammId: string, amount: number, slippageX: number, maxLamports: number, useVersionedTransaction: boolean, fixedSide: 'in' | 'out' }) {
    return this.raydiumSwapService.simulateSignedSwapTransaction(body.fromToken, body.toToken, body.ammId, body.amount, body.slippageX, body.maxLamports, body.useVersionedTransaction, body.fixedSide);
  }

  @Get('convertToWrapSol')
  async convertToWrapSol(@Body() body: { amount: number }) {
    return this.raydiumSwapService.convertToWrapSol(body.amount);
  }

}