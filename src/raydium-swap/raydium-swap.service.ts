import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, TransactionMessage, SystemProgram, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
    Liquidity,
    LiquidityPoolKeys,
    jsonInfo2PoolKeys,
    LiquidityPoolJsonInfo,
    TokenAccount,
    Token,
    TokenAmount,
    TOKEN_PROGRAM_ID,
    Percent,
    SPL_ACCOUNT_LAYOUT,
    Price,
} from '@raydium-io/raydium-sdk'
import { Wallet } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import fs from 'fs';
import path from 'path';
import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddress, NATIVE_MINT } from '@solana/spl-token';
import axios from 'axios';
/**
 * Class representing a Raydium Swap operation.
 */
import { Injectable } from '@nestjs/common';
import { SolanaService } from 'src/solana/solana.service';

@Injectable()
export class RaydiumSwapService {
    // private allPoolKeysJson: LiquidityPoolJsonInfo[]
    // private connection: Connection
    // private wallet: Wallet

    /**
   * Create a RaydiumSwap instance.
   * @param {string} RPC_URL - The RPC URL for connecting to the Solana blockchain.
   * @param {string} WALLET_PRIVATE_KEY - The private key of the wallet in base58 format.
   */
    constructor(private readonly solanaService: SolanaService) {
        // this.connection = await this.solanaService.getConnectionWithFallback()
        // this.wallet = await this.solanaService.getBackendKeypair()
    }

    // /**
    // * Loads all the pool keys available from a JSON configuration file.
    // * @async
    // * @returns {Promise<void>}
    // */
    // async loadPoolKeys(liquidityFile: string) {
    //     let liquidityJson;
    //     if (liquidityFile.startsWith('http')) {
    //         const liquidityJsonResp = await fetch(liquidityFile);
    //         if (!liquidityJsonResp.ok) return;
    //         liquidityJson = await liquidityJsonResp.json();
    //     }
    //     else {
    //         liquidityJson = JSON.parse(fs.readFileSync(path.join(__dirname, liquidityFile), 'utf-8'));
    //     }
    //     const allPoolKeysJson = [...(liquidityJson?.official ?? []), ...(liquidityJson?.unOfficial ?? [])]

    //     this.allPoolKeysJson = allPoolKeysJson
    // }

    async getPoolKeysFromAmmId(ammId: string) {
        const poolKeys = await axios.get(`https://api-v3.raydium.io/pools/key/ids?ids=${ammId}`);

        let output = {
            official: [
                {
                    id: poolKeys.data.data[0].id,
                    baseMint: poolKeys.data.data[0].mintA.address,
                    quoteMint: poolKeys.data.data[0].mintB.address,
                    lpMint: poolKeys.data.data[0].mintLp.address,
                    baseDecimals: poolKeys.data.data[0].mintA.decimals,
                    quoteDecimals: poolKeys.data.data[0].mintB.decimals,
                    lpDecimals: poolKeys.data.data[0].mintLp.decimals,
                    version: 4, // TODO: check if this is correct
                    programId: poolKeys.data.data[0].programId,
                    authority: poolKeys.data.data[0].authority,
                    openOrders: poolKeys.data.data[0].openOrders,
                    targetOrders: poolKeys.data.data[0].targetOrders,
                    baseVault: poolKeys.data.data[0].vault.A,
                    quoteVault: poolKeys.data.data[0].vault.B,
                    "withdrawQueue": "11111111111111111111111111111111",
                    "lpVault": "11111111111111111111111111111111",
                    marketVersion: 4, // TODO: check if this is correct
                    marketProgramId: poolKeys.data.data[0].marketProgramId,
                    marketId: poolKeys.data.data[0].marketId,
                    marketAuthority: poolKeys.data.data[0].marketAuthority,
                    marketBaseVault: poolKeys.data.data[0].marketBaseVault,
                    marketQuoteVault: poolKeys.data.data[0].marketQuoteVault,
                    marketBids: poolKeys.data.data[0].marketBids,
                    marketAsks: poolKeys.data.data[0].marketAsks,
                    marketEventQueue: poolKeys.data.data[0].marketEventQueue,
                    lookupTableAccount: poolKeys.data.data[0].lookupTableAccount,
                }
            ]
        }

        // ...(output?.unOfficial ?? [])
        const allPoolKeysJson = [...(output?.official ?? []),]
        return allPoolKeysJson
    }

    async findPoolInfoForTokens(ammId: string, mintA: string, mintB: string) {
        let allPoolKeysJson = await this.getPoolKeysFromAmmId(ammId)
        const poolData = allPoolKeysJson.find(
            (i) => (i.baseMint === mintA && i.quoteMint === mintB) || (i.baseMint === mintB && i.quoteMint === mintA)
        )

        if (!poolData) return null

        return jsonInfo2PoolKeys(poolData) as LiquidityPoolKeys
    }

    /**
   * Retrieves token accounts owned by the wallet.
   * @async
   * @returns {Promise<TokenAccount[]>} An array of token accounts.
   */
    async getOwnerTokenAccounts(owner: string) {
        const connection = await this.solanaService.getConnectionWithFallback()
        // const wallet = await this.solanaService.getBackendKeypair()
        const walletTokenAccount = await connection.getTokenAccountsByOwner(new PublicKey(owner), {
            programId: TOKEN_PROGRAM_ID,
        })

        return walletTokenAccount.value.map((i) => ({
            pubkey: i.pubkey,
            programId: i.account.owner,
            accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
        }))
    }

    /**
   * Builds a swap transaction.
   * @async
   * @param {string} toToken - The mint address of the token to receive.
   * @param {number} amount - The amount of the token to swap.
   * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
   * @param {number} [maxLamports=100000] - The maximum lamports to use for transaction fees.
   * @param {boolean} [useVersionedTransaction=true] - Whether to use a versioned transaction.
   * @param {'in' | 'out'} [fixedSide='in'] - The fixed side of the swap ('in' or 'out').
   * @returns {Promise<Transaction | VersionedTransaction>} The constructed swap transaction.
   */
    async getSwapTransaction(
        fromToken: string,
        toToken: string,
        ammId: string,
        amount: number,
        slippageX: number,
        maxLamports: number = 100000,
        useVersionedTransaction = true,
        fixedSide: 'in' | 'out' = 'in'
    ): Promise<Transaction | VersionedTransaction> {
        console.log("Getting swap transaction, fromToken: ", fromToken, " toToken: ", toToken, " ammId: ", ammId, " amount: ", amount, " slippageX: ", slippageX, " maxLamports: ", maxLamports, " useVersionedTransaction: ", useVersionedTransaction, " fixedSide: ", fixedSide)
        const connection = await this.solanaService.getConnectionWithFallback()
        const wallet = await this.solanaService.getBackendKeypair()
        const poolKeys = await this.findPoolInfoForTokens(ammId, fromToken, toToken)
        if (!poolKeys) {
            console.error('Pool info not found for swap from: ', fromToken, ' to: ', toToken, 'amount: ', amount, 'slippageX: ', slippageX);
            throw new Error(`Pool info not found for swap from: ${fromToken} to: ${toToken} amount: ${amount} slippageX: ${slippageX}`);
        } else {
            console.log('Found pool info');
        }
        const directionIn = poolKeys.quoteMint.toString() == toToken
        const { minAmountOut, amountIn } = await this.calcAmountOut(poolKeys, amount, directionIn, slippageX)
        console.log("Calculated Swap minAmountOut: ", minAmountOut.toExact(), " toToken: ", toToken)
        console.log("Calculated Swap amountIn: ", amountIn.toExact(), " fromToken: ", fromToken)
        const userTokenAccounts = await this.getOwnerTokenAccounts(wallet.publicKey.toString())
        const swapTransaction = await Liquidity.makeSwapInstructionSimple({
            connection: connection,
            makeTxVersion: useVersionedTransaction ? 0 : 1,
            poolKeys: {
                ...poolKeys,
            },
            userKeys: {
                tokenAccounts: userTokenAccounts,
                owner: wallet.publicKey,
            },
            amountIn: amountIn,
            amountOut: minAmountOut,
            fixedSide: fixedSide,
            config: {
                bypassAssociatedCheck: false,
            },
            computeBudgetConfig: {
                microLamports: maxLamports,
            },
        })

        const recentBlockhashForSwap = await connection.getLatestBlockhash()
        const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean)

        if (useVersionedTransaction) {
            const versionedTransaction = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: wallet.publicKey,
                    recentBlockhash: recentBlockhashForSwap.blockhash,
                    instructions: instructions,
                }).compileToV0Message()
            )

            versionedTransaction.sign([wallet])

            return versionedTransaction
        }

        const legacyTransaction = new Transaction({
            blockhash: recentBlockhashForSwap.blockhash,
            lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
            feePayer: wallet.publicKey,
        })

        legacyTransaction.add(...instructions)

        return legacyTransaction
    }

    async sendSignedSwapTransaction(fromToken: string,
        toToken: string,
        ammId: string,
        amount: number,
        slippageX: number,
        maxLamports: number = 100000,
        useVersionedTransaction = true,
        fixedSide: 'in' | 'out' = 'in',
        maxRetries: number = 20
    ) {
        let tx = await this.getSwapTransaction(fromToken, toToken, ammId, amount, slippageX, maxLamports, useVersionedTransaction, fixedSide)
        let txid = ''
        if (tx instanceof VersionedTransaction) {
            txid = await this.sendVersionedTransaction(tx, maxRetries)
        } else {
            txid = await this.sendLegacyTransaction(tx, maxRetries)
        }
        console.log("swap tx submitted, solscan tx url: ", `https://solscan.io/tx/${txid}`)

        const confirmation = await this.solanaService.confirmTransaction(txid)
        console.log("confirmation: ", confirmation)

        return txid
    }

    async simulateSignedSwapTransaction(fromToken: string,
        toToken: string,
        ammId: string,
        amount: number,
        slippageX: number,
        maxLamports: number = 100000,
        useVersionedTransaction = true,
        fixedSide: 'in' | 'out' = 'in') {
        let tx = await this.getSwapTransaction(fromToken, toToken, ammId, amount, slippageX, maxLamports, useVersionedTransaction, fixedSide)
        let simulation = null
        if (tx instanceof Transaction) {
            simulation = await this.simulateLegacyTransaction(tx)
        } else {
            simulation = await this.simulateVersionedTransaction(tx)
        }
        console.log("simulation of swap tx: ", simulation)
        return simulation
    }

    /**
   * Sends a legacy transaction.
   * @async
   * @param {Transaction} tx - The transaction to send.
   * @returns {Promise<string>} The transaction ID.
   */
    async sendLegacyTransaction(tx: Transaction, maxRetries?: number) {
        const connection = await this.solanaService.getConnectionWithFallback()
        const wallet = await this.solanaService.getBackendKeypair()
        const txid = await connection.sendTransaction(tx, [wallet], {
            skipPreflight: true,
            maxRetries: maxRetries,
        })

        return txid
    }

    /**
   * Sends a versioned transaction.
   * @async
   * @param {VersionedTransaction} tx - The versioned transaction to send.
   * @returns {Promise<string>} The transaction ID.
   */
    async sendVersionedTransaction(tx: VersionedTransaction, maxRetries?: number) {
        const connection = await this.solanaService.getConnectionWithFallback()
        const wallet = await this.solanaService.getBackendKeypair()
        const txid = await connection.sendTransaction(tx, {
            skipPreflight: true,
            maxRetries: maxRetries,
        })

        return txid
    }

    /**
      * Simulates a versioned transaction.
      * @async
      * @param {VersionedTransaction} tx - The versioned transaction to simulate.
      * @returns {Promise<any>} The simulation result.
      */
    async simulateLegacyTransaction(tx: Transaction) {
        const connection = await this.solanaService.getConnectionWithFallback()
        const wallet = await this.solanaService.getBackendKeypair()
        const txid = await connection.simulateTransaction(tx, [wallet])

        return txid
    }

    /**
   * Simulates a versioned transaction.
   * @async
   * @param {VersionedTransaction} tx - The versioned transaction to simulate.
   * @returns {Promise<any>} The simulation result.
   */
    async simulateVersionedTransaction(tx: VersionedTransaction) {
        const connection = await this.solanaService.getConnectionWithFallback()
        const txid = await connection.simulateTransaction(tx)

        return txid
    }

    /**
   * Calculates the amount out for a swap.
   * @async
   * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
   * @param {number} rawAmountIn - The raw amount of the input token.
   * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
   * @returns {Promise<Object>} The swap calculation result.
   */
    async calcAmountOut(poolKeys: LiquidityPoolKeys, rawAmountIn: number, swapInDirection: boolean, slippageX: number) {
        const connection = await this.solanaService.getConnectionWithFallback()
        const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys })

        let currencyInMint = poolKeys.baseMint
        let currencyInDecimals = poolInfo.baseDecimals
        let currencyOutMint = poolKeys.quoteMint
        let currencyOutDecimals = poolInfo.quoteDecimals

        if (!swapInDirection) {
            currencyInMint = poolKeys.quoteMint
            currencyInDecimals = poolInfo.quoteDecimals
            currencyOutMint = poolKeys.baseMint
            currencyOutDecimals = poolInfo.baseDecimals
        }

        const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
        const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
        const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
        const slippage = new Percent(slippageX, 100) // 5% slippage

        const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn,
            currencyOut,
            slippage,
        })

        return {
            amountIn,
            amountOut,
            minAmountOut,
            currentPrice,
            executionPrice,
            priceImpact,
            fee,
        }
    }

    /**
     * Calculates the amount in for a swap. 
     * @async
     * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
     * @param {number} rawAmountOut - The raw amount of the output token.
     * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
     * @returns {Promise<Object>} The swap calculation result.
     */
    async calcAmountIn(poolKeys: LiquidityPoolKeys, rawAmountOut: number, swapInDirection: boolean, slippageX: number) {
        const connection = await this.solanaService.getConnectionWithFallback()
        const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys })

        console.log("poolKeys.quoteMint.toString()", poolKeys.quoteMint.toString())
        console.log("poolKeys.baseMint.toString()", poolKeys.baseMint.toString())

        let currencyInMint = poolKeys.baseMint
        let currencyInDecimals = poolInfo.baseDecimals
        let currencyOutMint = poolKeys.quoteMint
        let currencyOutDecimals = poolInfo.quoteDecimals

        if (!swapInDirection) {
            currencyInMint = poolKeys.quoteMint
            currencyInDecimals = poolInfo.quoteDecimals
            currencyOutMint = poolKeys.baseMint
            currencyOutDecimals = poolInfo.baseDecimals
        }

        // CHECK
        if (currencyInMint.toString() != NATIVE_MINT.toString()) {
            console.log("currencyInMint.toString()", currencyInMint.toString())
            console.error("ERROR: currencyInMint is not NATIVE_MINT")
            return
        }

        const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
        const amountOut = new TokenAmount(currencyIn, rawAmountOut, false)
        console.log("amountOut: ", amountOut.toExact())
        const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
        const slippage = new Percent(slippageX, 100) // 5% slippage

        const { amountIn, maxAmountIn, currentPrice, executionPrice, priceImpact } = Liquidity.computeAmountIn({
            poolKeys,
            poolInfo,
            amountOut,
            currencyIn,
            slippage
        });

        return {
            amountIn,
            maxAmountIn,
            currentPrice,
            executionPrice,
            priceImpact,
            amountOut,
            currencyInMint,
            currencyOutMint,
            currencyInDecimals,
            currencyOutDecimals,
        }
    }

    /**
  * Builds a swap transaction.
  * @async
  * @param {string} toToken - The mint address of the token to receive.
  * @param {number} amount - The amount of the token to swap.
  * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
  * @param {number} [maxLamports=100000] - The maximum lamports to use for transaction fees.
  * @param {boolean} [useVersionedTransaction=true] - Whether to use a versioned transaction.
  * @param {'in' | 'out'} [fixedSide='in'] - The fixed side of the swap ('in' or 'out').
  * @returns {Promise<Transaction | VersionedTransaction>} The constructed swap transaction.
  */
    async getSwapOutTransaction(
        toToken: string,
        // fromToken: string,
        amount: number, // this is amount out
        slippageX: number,
        poolKeys: LiquidityPoolKeys,
        maxLamports: number = 100000,
        useVersionedTransaction = true,
        fixedSide: 'in' | 'out' = 'in'
    ): Promise<Transaction | VersionedTransaction> {
        const connection = await this.solanaService.getConnectionWithFallback()
        const wallet = await this.solanaService.getBackendKeypair()
        const directionIn = poolKeys.quoteMint.toString() == toToken
        console.log("directionIn", directionIn)
        const { maxAmountIn, amountIn, currentPrice, executionPrice, priceImpact,
            amountOut,
            currencyInMint,
            currencyOutMint,
            currencyInDecimals,
            currencyOutDecimals, } = await this.calcAmountIn(poolKeys, amount, directionIn, slippageX)

        console.log("Max Amount In: ", maxAmountIn.toExact())
        console.log("Amount In: ", amountIn.toExact())
        console.log("Amount Out: ", amountOut.toExact())
        console.log("Current Price: ", currentPrice.toFixed())
        console.log("Execution Price: ", executionPrice.toFixed())
        console.log("Price Impact: ", priceImpact)


        let tokenInUserATA = await getAssociatedTokenAddress(
            currencyInMint,
            wallet.publicKey
        );
        let tokenOutUserATA = await getAssociatedTokenAddress(
            currencyOutMint,
            wallet.publicKey
        );

        console.log("tokenInUserATA: ", tokenInUserATA.toString())
        console.log("tokenOutUserATA: ", tokenOutUserATA.toString())


        // poolKeys: LiquidityPoolKeys
        // userKeys: {
        //   tokenAccountIn: PublicKey
        //   tokenAccountOut: PublicKey
        //   owner: PublicKey
        // }
        // // maximum amount in
        // maxAmountIn: BigNumberish
        // amountOut: BigNumberish

        const swapIx = Liquidity.makeSwapFixedOutInstruction(
            {
                // connection: this.connection,
                // makeTxVersion: useVersionedTransaction ? 0 : 1,
                poolKeys: {
                    ...poolKeys,
                },
                userKeys: {
                    tokenAccountIn: tokenInUserATA,
                    tokenAccountOut: tokenOutUserATA,
                    owner: wallet.publicKey,
                },
                maxAmountIn: maxAmountIn.raw,
                amountOut: amountOut.raw,
                // fixedSide: fixedSide,
                // config: {
                //   bypassAssociatedCheck: false,
                // },
                // computeBudgetConfig: {
                //   microLamports: maxLamports,
                // },
            },
            poolKeys.version,
        )



        let recentBlockhashForSwap = await connection.getLatestBlockhash()

        if (useVersionedTransaction) {
            let instructions = []
            if (currencyInMint.toString() == NATIVE_MINT.toString()) {
                instructions.push(
                    SystemProgram.transfer({
                        fromPubkey: wallet.publicKey,
                        toPubkey: tokenInUserATA,
                        lamports: amountIn.raw.toNumber(),
                    }),
                    createSyncNativeInstruction(tokenInUserATA, TOKEN_PROGRAM_ID),
                    ...swapIx.innerTransaction.instructions,
                )
            } else {
                instructions = [
                    ...swapIx.innerTransaction.instructions,
                ]
            }

            const versionedTransaction = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: wallet.publicKey,
                    recentBlockhash: recentBlockhashForSwap.blockhash,
                    instructions: instructions,
                }).compileToV0Message()
            )

            versionedTransaction.sign([wallet])

            return versionedTransaction
        }

        const legacyTransaction = new Transaction({
            blockhash: recentBlockhashForSwap.blockhash,
            lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
            feePayer: wallet.publicKey,
        })

        // // The funds require to make a swap are now available in User's wSOL ATA
        if (currencyInMint.toString() == NATIVE_MINT.toString()) {

            legacyTransaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 744_452 }),
                ComputeBudgetProgram.setComputeUnitLimit({ units: 183_504 }),
            )

            legacyTransaction.add(
                createAssociatedTokenAccountIdempotentInstruction(
                    wallet.publicKey,
                    tokenInUserATA,
                    wallet.publicKey,
                    currencyInMint,
                ),
            )

            console.log("Adding sync native instruction for SOL -> WSOL")
            // Convert SOL to Wrapped SOL
            legacyTransaction.add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: tokenInUserATA,
                    lamports: maxAmountIn.raw.toNumber(),
                }),
                createSyncNativeInstruction(tokenInUserATA, TOKEN_PROGRAM_ID) // SOL -> WSOL
            );
        }

        legacyTransaction.add(...swapIx.innerTransaction.instructions)

        return legacyTransaction
    }

    async convertToWrapSol(amount: number): Promise<Transaction | VersionedTransaction> {
        const connection = await this.solanaService.getConnectionWithFallback()
        const wallet = await this.solanaService.getBackendKeypair()
        let recentBlockhashForWrapSol = await connection.getLatestBlockhash()

        let tokenInUserATA = await getAssociatedTokenAddress(
            NATIVE_MINT,
            wallet.publicKey
        );

        let legacyTransaction = new Transaction({
            blockhash: recentBlockhashForWrapSol.blockhash,
            lastValidBlockHeight: recentBlockhashForWrapSol.lastValidBlockHeight,
            feePayer: wallet.publicKey,
        })

        legacyTransaction.add(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 744_452 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 183_504 }),
        )

        legacyTransaction.add(
            SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: tokenInUserATA,
                lamports: amount * LAMPORTS_PER_SOL,
            }),
            createSyncNativeInstruction(tokenInUserATA, TOKEN_PROGRAM_ID)
        )

        return legacyTransaction
    }

}
