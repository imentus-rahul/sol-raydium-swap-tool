import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import axios from 'axios';
import Decimal from 'decimal.js';
import fs from 'fs';
import { clusterApiUrl, Connection, PublicKey, VersionedMessage, Keypair, Transaction, LAMPORTS_PER_SOL, SystemProgram, TransactionInstruction, ComputeBudgetProgram, TransactionExpiredBlockheightExceededError, SendTransactionError, ParsedInstruction } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, MAINNET_PROGRAM_ID, LiquidityPoolKeys } from '@raydium-io/raydium-sdk';
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, createTransferInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, TokenAccountNotFoundError } from '@solana/spl-token';

dotenv.config();

@Injectable()
export class SolanaService {
    private readonly logger = new Logger(SolanaService.name);

    private endpoints: string[] = [];
    private connections: Connection[] = []; // connections pool
    private initialized = false;
    private backendKeypair: Keypair;
    private errorLogFilePaths: string[] = [
        'logs/error_logs/all_error.log',
        'logs/error_logs/should_retry_error.log',
        'logs/error_logs/should_not_retry_error.log'
    ];

    onModuleInit() {
        console.log("SolanaService onModuleInit");
        if (!this.initialized) {
            this.logger.log('Initializing Solana Connection');
            const e1 = process.env.RPC_URL_1;
            const e2 = process.env.RPC_URL_2;
            const e3 = process.env.RPC_URL_3;
            const e4 = process.env.RPC_URL_4;
            const e5 = process.env.RPC_URL_5;
            const e6 = process.env.RPC_URL_6;
            const e7 = process.env.RPC_URL_7;

            this.endpoints = [e1, e2, e3, e4, e5, e6, e7].filter(Boolean);
            if (this.endpoints.length === 0) {
                this.endpoints.push(clusterApiUrl('mainnet-beta'));
            }

            // // Setting up connections pool
            this.connections = this.endpoints.map((endpoint) => {
                this.logger.log(`onModuleInit - Creating Solana Connection for endpoint: ${endpoint}`);
                return new Connection(endpoint, 'confirmed');
            });

            // // Setting up backend keypair
            this.backendKeypair = Keypair.fromSecretKey(
                new Uint8Array(process.env.BACKEND_KEYPAIR_SECRET_KEY.split(',').map((e: any) => e * 1)),
            );

            // Reset or create error log files, ensures path already exists, otherwise creates it
            this.errorLogFilePaths.forEach((filePath) => {
                console.log("filePath: ", filePath);
                const logFilePath = filePath;
                if (!fs.existsSync(logFilePath)) {
                    // creates directory if it doesn't exist
                    let dirPath = logFilePath.split('/').slice(0, -1).join('/');
                    fs.mkdirSync(dirPath, { recursive: true });
                    fs.writeFileSync(logFilePath, '');
                }
                else {
                    fs.writeFileSync(logFilePath, '');
                }
            });

            this.initialized = true;
        }
    }

    private logErrorToFile(errorString: string, logFilePathIndex: number = 0) {
        const logFilePath = this.errorLogFilePaths[logFilePathIndex];
        const logMessage = `${new Date().toISOString()} - Error: ${errorString}\n`;
        fs.appendFileSync(logFilePath, logMessage);
    }

    private delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Retry mechanism
    // The error occurred in any function wrapped by this retry function will be caught by the catch block inside the retry function.
    // The error message will be logged using this.logger.error().
    // The error will be recorded in the log file using this.logErrorToFile(error).
    // The method will wait for an exponentially increasing delay before retrying the operation, minimum delay is 0.5 second.
    private async retry<T>(fn: () => Promise<T>, retries: number = 3, delay: number = 500): Promise<T> {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                // Add name of the function to the error message
                let errorString = `Attempt ${attempt + 1} failed for function name: ${fn.name} with error: ${error.message} | ERROR_NAME: ${error.name} | ERROR_CODE: ${error.code} | ERROR_REASON: ${error.reason}`;
                this.logger.error(errorString);
                this.logErrorToFile(errorString, 0);

                if (this.shouldRetry(error)) {
                    if (attempt < retries - 1) {
                        errorString = `Retrying... Attempt ${attempt + 1} failed for function name: ${fn.name} with error: ${error.message} | ERROR_NAME: ${error.name} | ERROR_CODE: ${error.code} | ERROR_REASON: ${error.reason}`;
                        this.logger.error(errorString);
                        this.logErrorToFile(errorString, 1);
                        await this.delay(delay);
                        delay *= 2; // Exponential backoff
                    } else {
                        throw new HttpException('Max retries reached for function name: ' + fn.name, HttpStatus.INTERNAL_SERVER_ERROR);
                    }
                }
                else {
                    errorString = `Should not retry error occurred in retry function. ${errorString}`;
                    this.logger.error(errorString);
                    this.logErrorToFile(errorString, 2);
                    throw error;
                }
            }
        }
    }

    private shouldRetry(error: any): boolean {

        let errorMessagesToIgnore = ["InstructionError", "Insufficient funds for transaction", "AccountNotFoundError", "Simulation failed"];
        let errorCodesToIgnore = [12345678];

        // Check for specific error types
        // .some(): Determines whether the specified callback function returns true for any element of an array
        // .includes(): Determines whether an array includes a certain element, returning true or false as appropriate
        if (errorMessagesToIgnore.some(message => error.message.includes(message)) || errorCodesToIgnore.includes(error.code)) {
            return false; // Do not retry for these errors
        }

        // Retry for all issues not mentioned here
        // includes following: 
        // error instanceof TransactionExpiredBlockheightExceededError
        // 429, Too Many Requests, socket hang up, Request failed with status code 504, connect ETIMEDOUT, read ECONNRESET, write ECONNABORTED, getaddrinfo ENOTFOUND,
        return true;
    }


    /** 
     * Fallback approach: try each endpoint in order, return the first that works. 
     */
    async getConnectionWithFallback(): Promise<Connection> {
        return this.retry(async () => {
            for (let i = 0; i < this.connections.length; i++) {
                const conn = this.connections[i];
                try {
                    // Quick test to ensure the endpoint is responsive 
                    await conn.getVersion();
                    this.logger.log(`Using working endpoint: ${conn.rpcEndpoint}`);
                    return conn;
                } catch (err) {
                    this.logger.error(`Endpoint failed: ${conn.rpcEndpoint}`, err);
                    // move on to the next connection

                    // once all endpoints are tried, throw an error
                    if (i === this.connections.length - 1) {
                        throw new Error('All Solana RPC endpoints failed for creation of a connection object.');
                    }
                }
            }
        });
    }

    async getBackendKeypair() {
        return this.backendKeypair;
    }

    async getAccountInfo(publicKey: string) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            const accountInfo = await connection.getAccountInfo(new PublicKey(publicKey));
            return accountInfo;
        });
    }

    async getBlockHeight() {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            const blockHeight = await connection.getBlockHeight();
            return blockHeight;
        });
    }

    async getLatestBlockhash() {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            const latestBlockhash = await connection.getLatestBlockhash();
            return latestBlockhash;
        });
    }

    async getRecentPriorityFee(accountKeys: string[]) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            const priorityFee = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: accountKeys.map(key => new PublicKey(key)) });
            return priorityFee;
        });
    }

    // ix_getComputeBudgetIxs
    async ix_getComputeBudgetIxs(computeUnitPrice: number, computeUnitLimit: number) {
        return this.retry(async () => {
            const computeBudgetIxs = [
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice ? computeUnitPrice : 744_452 }),
                ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit ? computeUnitLimit : 183_504 })
            ]
            return computeBudgetIxs;
        });
    }

    // async getFeeForMessage(message: string) {
    //     const connection = await this.getConnectionWithFallback();
    //     // Convert the string message to a VersionedMessage
    //     const versionedMessage: VersionedMessage = {
    //         // Assuming you have a way to create a VersionedMessage from a string
    //         // This is a placeholder; you need to implement the conversion logic
    //         // For example, you might need to create a transaction or similar
    //         // Replace this with actual logic to create a VersionedMessage
    //         instructions: [],
    //         recentBlockhash: (await this.getLatestBlockhash()).blockhash,
    //         feePayer: this.backendKeypair.publicKey, // Replace with actual fee payer
    //     };
    //     const fee = await connection.getFeeForMessage(versionedMessage);
    //     return fee;
    // }

    async getTransactionReceipt(transactionHash: string) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            const transactionReceipt = await connection.getTransaction(transactionHash, { commitment: "finalized", maxSupportedTransactionVersion: 2 });

            let isSuccessful = false;
            // check if the transaction is successful
            if (transactionReceipt?.meta?.err == null) {
                isSuccessful = true;
            } else {
                isSuccessful = false;
            }

            return { transactionReceipt, isSuccessful };
        });
    }

    async getParsedTransactionReceipt(transactionHash: string) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            const transactionReceipt = await connection.getParsedTransaction(transactionHash, { commitment: "finalized", maxSupportedTransactionVersion: 2 });
            return transactionReceipt;
        });
    }

    async getBothTransactionReceipt(transactionHash: string) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();

            let latestBlockhash = await this.getLatestBlockhash();

            let confirmation_response = await connection.confirmTransaction({ signature: transactionHash, ...latestBlockhash });
            let transactionReceipt = await connection.getTransaction(transactionHash, { commitment: "finalized", maxSupportedTransactionVersion: 2 });
            let parsedTransactionReceipt = await connection.getParsedTransaction(transactionHash, { commitment: "finalized", maxSupportedTransactionVersion: 2 });

            return { confirmation_response, transactionReceipt, parsedTransactionReceipt };
        });
    }

    async signTx(transaction: string, arrayOfStringKeypairs: string[]) {
        return this.retry(async () => {
            let arrayOfKeypairs: Keypair[] = arrayOfStringKeypairs.map(keypair => Keypair.fromSecretKey(new Uint8Array(keypair.split(',').map(Number))));
            // Transaction.from: Parse a wire transaction into a Transaction object
            // Transaction.populate: Populate Transaction object from message and signatures
            let rawTransaction = Transaction.from(Buffer.from(transaction, 'base64'));
            rawTransaction.sign(...arrayOfKeypairs);
            return rawTransaction.serializeMessage();
        });
    }

    async sendSignedTx(transaction: string) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            try {
                // Transaction.from: Parse a wire transaction into a Transaction object
                // Transaction.populate: Populate Transaction object from message and signatures
                let signedTransaction = Transaction.from(Buffer.from(transaction, 'base64'));
                let transactionHash = connection.sendRawTransaction(signedTransaction.serialize());
                return transactionHash;
            } catch (error) {
                if (error instanceof SendTransactionError) {
                    console.log("SendTransactionError: ", error);
                    console.log("SendTransactionError getLogs: ", await error.getLogs(connection));
                }
                throw error;
            }
        });
    }

    async signAndSendTx(transaction: string, arrayOfStringKeypairs: string[]) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            let arrayOfKeypairs: Keypair[] = arrayOfStringKeypairs.map(keypair => Keypair.fromSecretKey(new Uint8Array(keypair.split(',').map(Number))));

            try {
                // Transaction.from: Parse a wire transaction into a Transaction object
                // Transaction.populate: Populate Transaction object from message and signatures
                let rawTransaction = Transaction.from(Buffer.from(transaction, 'base64'));
                rawTransaction.sign(...arrayOfKeypairs);
                let transactionHash = connection.sendRawTransaction(rawTransaction.serialize());
                return transactionHash;
            } catch (error) {
                if (error instanceof SendTransactionError) {
                    console.log("SendTransactionError: ", error);
                    console.log("SendTransactionError getLogs: ", await error.getLogs(connection));
                }
                throw error;
            }
        });
    }

    async confirmTransaction(transactionHash: string) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            let latestBlockhash = await this.getLatestBlockhash();
            let confirmation_response = await connection.confirmTransaction({ signature: transactionHash, ...latestBlockhash });
            return confirmation_response;
        });
    }

    // Native Tokens
    async getSOLBalance(accountToFetch: string) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            let userPublicKey = new PublicKey(accountToFetch);

            let balance = await connection.getBalance(userPublicKey);
            return { balanceInLamports: balance, balanceInSol: balance / LAMPORTS_PER_SOL };
        });
    }

    async tx_transferSOL(fromAddress: string, recipientAddress: string, amount: number) {
        return this.retry(async () => {
            const connection = await this.getConnectionWithFallback();
            let createAccountFlag = false;
            let createAccountIx = null;

            // TODO: check if the recipient address is a valid address created on Solana ledger (paid min rent), if not, add ix for CreateAccount
            const recipientAccountInfo = await connection.getAccountInfo(new PublicKey(recipientAddress));
            if (!recipientAccountInfo) {
                console.log("Recipient account does not exist on Solana Ledger. Creating System Account...");
                // Create account ix
                createAccountIx = new TransactionInstruction(
                    SystemProgram.createAccount({
                        /** The account that will transfer lamports to the created account */
                        fromPubkey: new PublicKey(fromAddress),
                        /** Public key of the created account */
                        newAccountPubkey: new PublicKey(recipientAddress),
                        /** Amount of lamports to transfer to the created account */
                        lamports: 890880, // solana rent 0 // Rent-exempt minimum: 0.00089088 SOL // 890880 lamports, 2 Yr Rent Exempt
                        /** Amount of space in bytes to allocate to the created account */
                        space: 0,
                        /** Public key of the program to assign as the owner of the created account */
                        programId: SystemProgram.programId
                    })
                );
                createAccountFlag = true;
            }

            const transaction = new Transaction().add(
                createAccountFlag ? createAccountIx : null,
                SystemProgram.transfer({
                    fromPubkey: new PublicKey(fromAddress),
                    toPubkey: new PublicKey(recipientAddress),
                    lamports: amount
                })
            );

            const { blockhash } = await this.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = new PublicKey(fromAddress);

            return transaction.serializeMessage().toString('base64');
        });
    }

    async getPreAndPostSolanaBalance(transactionHash: string, owner: string) {
        return this.retry(async () => {
            let parsedTx = await this.getParsedTransactionReceipt(transactionHash);
            const accountKeys = parsedTx.transaction.message.accountKeys.map(key => key.pubkey.toString());
            const ownerIndex = accountKeys.indexOf(owner);

            const preBalanceInLamports = parsedTx.meta?.preBalances[ownerIndex];
            const preBalanceInSol = preBalanceInLamports / LAMPORTS_PER_SOL;
            const postBalanceInLamports = parsedTx.meta?.postBalances[ownerIndex];
            const postBalanceInSol = postBalanceInLamports / LAMPORTS_PER_SOL;

            const gasFeeInLamports = parsedTx.meta?.fee;
            const gasFeeInSol = gasFeeInLamports / LAMPORTS_PER_SOL;

            return {
                preBalanceInLamports: preBalanceInLamports,
                preBalanceInSol: preBalanceInSol,
                postBalanceInLamports: postBalanceInLamports,
                postBalanceInSol: postBalanceInSol,
                changeInLamports: Math.abs(postBalanceInLamports - preBalanceInLamports),
                changeInSol: Math.abs((postBalanceInLamports - preBalanceInLamports) / LAMPORTS_PER_SOL),
                gasFeeInLamports: gasFeeInLamports,
                gasFeeInSol: gasFeeInSol
            }
        });
    }

    // // SPL Token Program
    // getTokenAccount
    async getTokenAccount(mintAddress: string, owner: string) {
        return this.retry(async () => {
            let tokenAccount = (getAssociatedTokenAddressSync(new PublicKey(mintAddress), new PublicKey(owner))).toBase58();
            return tokenAccount;
        });
    }
    // ix_createTokenAccount
    async ix_createTokenAccount(mintAddress: string, owner: string) {
        return this.retry(async () => {
            let ownerPublicKey = new PublicKey(owner);
            let ownerATA = new PublicKey(this.getTokenAccount(mintAddress, owner));

            let createTokenAccountIx: TransactionInstruction = createAssociatedTokenAccountIdempotentInstruction(
                ownerPublicKey,
                ownerATA,
                ownerPublicKey,
                new PublicKey(mintAddress),
            )

            return createTokenAccountIx;
        });
    }
    // ix_transferToken
    async ix_transferToken(mintAddress: string, owner: string, recipientAddress: string, amount: number) {
        return this.retry(async () => {
            let ownerPublicKey = new PublicKey(owner);
            let ownerATA = new PublicKey(this.getTokenAccount(mintAddress, owner));
            let recipientATA = new PublicKey(this.getTokenAccount(mintAddress, recipientAddress));

            let transferTokenIx: TransactionInstruction = createTransferInstruction(
                ownerATA,
                recipientATA,
                ownerPublicKey,
                amount
            )
            return transferTokenIx;
        });
    }
    // ix_syncNativeToken
    async ix_syncNativeToken(recipientAddress: string) {
        return this.retry(async () => {
            let recipientATA = new PublicKey(this.getTokenAccount(NATIVE_MINT.toBase58(), recipientAddress));

            let syncNativeTokenIx: TransactionInstruction = createSyncNativeInstruction(recipientATA)
            return syncNativeTokenIx;
        });
    }
    // ix_unwrapSolCloseTokenAccount // unwrap wsolana to solana
    async ix_unwrapSolCloseTokenAccount(recipientAddress: string) {
        return this.retry(async () => {
            let ownerPublicKey = new PublicKey(recipientAddress);
            let recipientATA = new PublicKey(this.getTokenAccount(NATIVE_MINT.toBase58(), recipientAddress));

            let closeTokenAccountIx: TransactionInstruction = createCloseAccountInstruction(
                recipientATA, // WSOL account in case of unwrapping wsolana to solana
                ownerPublicKey, // Destination (your SOL account)
                ownerPublicKey, // Owner of the WSOL account
            )
            return closeTokenAccountIx;
        });
    }
    // getAllTokenAccounts
    async getAllTokenAccounts(owner: string) {
        return this.retry(async () => {
            const ownerPublicKey = new PublicKey(owner);

            const connection = await this.getConnectionWithFallback();
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, { programId: TOKEN_PROGRAM_ID });
            return tokenAccounts;
        });
    }

    // getPreAndPostTokenBalance
    async getPreAndPostTokenBalance(transactionHash: string, owner: string) {
        return this.retry(async () => {

            let parsedTx = await this.getParsedTransactionReceipt(transactionHash);

            const accountKeys = parsedTx.transaction.message.accountKeys.map(key => key.pubkey.toString());
            // console.log("accountKeys.length", accountKeys.length);

            const ownerIndex = accountKeys.indexOf(owner);
            // console.log("index at which owner's token balance is expected", ownerIndex);

            const preBalances = parsedTx.meta?.preTokenBalances || [];
            const postBalances = parsedTx.meta?.postTokenBalances || [];

            // Create maps for pre and post balances
            const preBalanceMap = [];
            const postBalanceMap = [];
            const differenceBalanceMap = []; // calculate the difference between pre and post balances in a given transaction

            // Process pre-balances
            preBalances.forEach(preBalanceElement => {
                if (preBalanceElement.owner === owner) {
                    preBalanceMap.push({
                        owner: preBalanceElement.owner,
                        mint: preBalanceElement.mint,
                        uiAmount: preBalanceElement.uiTokenAmount?.uiAmount || 0,
                        decimals: preBalanceElement.uiTokenAmount?.decimals
                    });
                }
            });

            // Process post-balances
            postBalances.forEach(postBalanceElement => {
                if (postBalanceElement.owner === owner) {
                    postBalanceMap.push({
                        owner: postBalanceElement.owner,
                        mint: postBalanceElement.mint,
                        uiAmount: postBalanceElement.uiTokenAmount?.uiAmount || 0,
                        decimals: postBalanceElement.uiTokenAmount?.decimals
                    });
                }
            });

            // check postBalanceMap for owner, find common owner and mint in preBalanceMap
            postBalanceMap.forEach(postBalanceElement => {
                const preBalanceElement = preBalanceMap.find(b => b.mint === postBalanceElement.mint && b.owner === postBalanceElement.owner);
                // console.log("balance.uiAmount: ", balance?.uiAmount, "preBalance.uiAmount: ", preBalance?.uiAmount)
                if (preBalanceElement) {
                    differenceBalanceMap.push({
                        owner: postBalanceElement.owner,
                        mint: postBalanceElement.mint,
                        change: new Decimal(postBalanceElement?.uiAmount || 0).minus(new Decimal(preBalanceElement?.uiAmount || 0)), // JS difference leads to incorrect results in case of high precision decimals
                        decimals: postBalanceElement.decimals,
                        preBalanceUiAmount: preBalanceElement?.uiAmount || 0,
                        postBalanceUiAmount: postBalanceElement?.uiAmount || 0,
                    });
                }
                else { // if preBalance is not found, then it is a new token account created
                    differenceBalanceMap.push({
                        owner: postBalanceElement.owner,
                        mint: postBalanceElement.mint,
                        change: postBalanceElement?.uiAmount || 0,
                        decimals: postBalanceElement.decimals,
                        preBalanceUiAmount: preBalanceElement?.uiAmount || 0,
                        postBalanceUiAmount: postBalanceElement?.uiAmount || 0,
                    });
                }
            });

            console.log("differenceBalanceMap", differenceBalanceMap);

            // Sort changes to find input (negative) and output (positive) tokens
            const inputToken = differenceBalanceMap.find(c => c.change < 0);
            const outputToken = differenceBalanceMap.find(c => c.change > 0);

            return {
                // // cannot get WSOL pre and post token balances as data isn't available in the parsedTx
                inputToken: inputToken ? {
                    amount: Math.abs(inputToken?.change || 0),
                    mint: inputToken?.mint || '',
                    owner: inputToken?.owner || '',
                    decimals: inputToken?.decimals,
                    preTokenBalanceUiAmount: inputToken?.preBalanceUiAmount || 0,
                    postTokenBalanceUiAmount: inputToken?.postBalanceUiAmount || 0,
                    changeInTokenBalanceUiAmount: inputToken?.change || 0
                } : null,
                outputToken: outputToken ? {
                    amount: Math.abs(outputToken?.change || 0),
                    mint: outputToken?.mint || '',
                    owner: outputToken?.owner || '',
                    decimals: outputToken?.decimals,
                    preTokenBalanceUiAmount: outputToken?.preBalanceUiAmount || 0,
                    postTokenBalanceUiAmount: outputToken?.postBalanceUiAmount || 0,
                    changeInTokenBalanceUiAmount: outputToken?.change || 0
                } : null,
                timestamp: parsedTx.blockTime ? parsedTx.blockTime * 1000 : Date.now()
            };
        });
    }

    async findATACreationFee(transactionHash: string, owner: string): Promise<{ ataCreationFeeInLamports: number, ataCreationFeeInSol: number } | null> {
        let parsedTx = await this.getParsedTransactionReceipt(transactionHash);

        // Check if the parsed transaction has inner instructions
        if (!parsedTx.meta || !parsedTx.meta.innerInstructions) {
            return null; // No inner instructions found
        }

        let ataCreationFee = 0;
        // Iterate through inner instructions to find the "createAccount" instruction
        for (const instruction of parsedTx.meta.innerInstructions) {
            for (const innerInstruction of instruction.instructions as any) {
                if (innerInstruction?.parsed && innerInstruction?.parsed?.type === 'createAccount') {
                    const info = innerInstruction?.parsed?.info;

                    // Check if the owner and source match the provided values
                    if (info.owner === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" && info.source === owner && info.lamports == 2039280) {
                        // Return the fee charged (lamports)
                        ataCreationFee += info.lamports; // This is the amount of lamports charged for creating the account
                    }
                }
            }
        }

        // No matching createAccount instruction found in case of 0
        return {
            ataCreationFeeInLamports: ataCreationFee,
            ataCreationFeeInSol: ataCreationFee / LAMPORTS_PER_SOL
        }
    }

    // // getRaydiumLPStats
    async getRaydiumLPStats(ammId: string): Promise<any> {
        return this.retry(async () => {

            const ammIdPublicKey = new PublicKey(ammId);
            const connection = await this.getConnectionWithFallback();

            try {
                const ammAccountBlockchainAccountInfo = await connection.getAccountInfo(
                    ammIdPublicKey,
                );

                if (ammAccountBlockchainAccountInfo) {
                    const ammAccountDecodedPoolStateData =
                        LIQUIDITY_STATE_LAYOUT_V4.decode(
                            ammAccountBlockchainAccountInfo.data,
                        );

                    const marketAccount = await connection.getAccountInfo(
                        ammAccountDecodedPoolStateData.marketId,
                    );

                    if (marketAccount) {
                        const marketStateDecodedData = MARKET_STATE_LAYOUT_V3.decode(
                            marketAccount.data,
                        );

                        // Deriving PDA address
                        const marketAuthorityPDA = PublicKey.createProgramAddressSync(
                            [
                                marketStateDecodedData.ownAddress.toBuffer(),
                                marketStateDecodedData.vaultSignerNonce.toArrayLike(
                                    Buffer,
                                    'le',
                                    8,
                                ),
                            ],
                            MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
                        );

                        // baseVault: TokenAccount
                        // TODO: return the token account balance
                        const baseVaultAccountBlockchainAccountInfo = await connection.getAccountInfo(
                            ammAccountDecodedPoolStateData.baseVault,
                        );

                        // quoteVault: TokenAccount
                        // TODO: return the token account balance
                        const quoteVaultAccountBlockchainAccountInfo = await connection.getAccountInfo(
                            ammAccountDecodedPoolStateData.quoteVault,
                        );
                        console.log("🚀 ~ SolanaService ~ returnthis.retry ~ quoteVaultAccountBlockchainAccountInfo:", quoteVaultAccountBlockchainAccountInfo);
                        return {
                            id: new PublicKey(ammId),
                            programId: MAINNET_PROGRAM_ID.AmmV4,
                            status: ammAccountDecodedPoolStateData.status,
                            baseDecimals:
                                ammAccountDecodedPoolStateData.baseDecimal.toNumber(),
                            quoteDecimals:
                                ammAccountDecodedPoolStateData.quoteDecimal.toNumber(),
                            lpDecimals: 9,
                            baseMint: ammAccountDecodedPoolStateData.baseMint,
                            quoteMint: ammAccountDecodedPoolStateData.quoteMint,
                            version: 4,
                            authority: new PublicKey(
                                '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Hardcoded authority for AMMv4
                            ),
                            openOrders: ammAccountDecodedPoolStateData.openOrders,
                            baseVault: ammAccountDecodedPoolStateData.baseVault,
                            quoteVault: ammAccountDecodedPoolStateData.quoteVault,
                            marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
                            marketId: marketStateDecodedData.ownAddress,
                            marketBids: marketStateDecodedData.bids,
                            marketAsks: marketStateDecodedData.asks,
                            marketEventQueue: marketStateDecodedData.eventQueue,
                            marketBaseVault: marketStateDecodedData.baseVault,
                            marketQuoteVault: marketStateDecodedData.quoteVault,
                            marketAuthority: marketAuthorityPDA,
                            targetOrders: ammAccountDecodedPoolStateData.targetOrders,
                            lpMint: ammAccountDecodedPoolStateData.lpMint,

                            // // Market State Decoded Data
                            // ownAddress: PublicKey [PublicKey(EKxFqYxizorZLMXbJTCo5cBx4E2PHZ5bdRyiNt8Y62Vn)] {
                            //     _bn: <BN: c602dcd02df7e89e2d9164760dddb7c8b3af75e724f1884bcc0a7876ea681701>
                            //   },
                            //   vaultSignerNonce: <BN: 1>,
                            //   baseMint: PublicKey [PublicKey(FCK8PzfFaueVJEVZcy2q53yozr6QTYhaFixEaBNEa7YP)] {
                            //     _bn: <BN: d2e980b2b147ad08e0c3b351e27835fa97f147f41954ea95a01eab359459e50c>
                            //   },
                            //   quoteMint: PublicKey [PublicKey(So11111111111111111111111111111111111111112)] {
                            //     _bn: <BN: 69b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001>
                            //   },
                            //   baseVault: PublicKey [PublicKey(EP5QVWwRQBCWkb1jNRYNf3stVABZJZqjbvLxeNCG3q6B)] {
                            //     _bn: <BN: c6cfb049a88ba953dba3d85a887515b8187319d566f60ee26e0c0edd3e6aaecc>
                            //   },
                            //   baseDepositsTotal: <BN: 0>,
                            //   baseFeesAccrued: <BN: 0>,
                            //   quoteVault: PublicKey [PublicKey(Bvmfk8wacmZchnG5Mt1DWbhz3aT6e9vGRLv9Nf1Eobwv)] {
                            //     _bn: <BN: a25b288d6e051512794c25f2f091f92649025d64209e4ff0171e5dc7634df839>
                            //   },
                            //   quoteDepositsTotal: <BN: 0>,
                            //   quoteFeesAccrued: <BN: 0>,
                            //   quoteDustThreshold: <BN: 64>,
                            //   requestQueue: PublicKey [PublicKey(ArEgpQGNbY5Axc4KG4jWPozB85i3jvDnDcKhVFHi2FtJ)] {
                            //     _bn: <BN: 92561e0b6c8efe2f83896a30ca1792f9c87ef03c8a6c85fe09b215f9ac2024cf>
                            //   },
                            //   eventQueue: PublicKey [PublicKey(DQkj2mxFUGZr8EEHrfaEar8ZXVCpRoCXSaLoUZCpNgeE)] {
                            //     _bn: <BN: b8620a96b26bdcf9cc6aab62e7a37ef2d477e1b7307030022b895d891795ad83>
                            //   },
                            //   bids: PublicKey [PublicKey(8oCfNLkrPCRVSd4JpnvX9WbSYkbDycdRdRTNAGFhCHC8)] {
                            //     _bn: <BN: 73d7b61fa51fa83f7bad14561f662eeee4365bd761256f5ac0072540dd7322fd>
                            //   },
                            //   asks: PublicKey [PublicKey(FAYFa2d44EHvZaLMe8swPK5SnE7XEDxRcbmW1pYAsSyS)] {
                            //     _bn: <BN: d2752e1a848df6d9dd32e1584c95e71c9068532ad1a693b7ed29d72fe2a09fcd>
                            //   },
                            //   baseLotSize: <BN: f4240>,
                            //   quoteLotSize: <BN: 989680>,
                            //   feeRateBps: <BN: 0>,
                            //   referrerRebatesAccrued: <BN: 0>

                            marketStateOwnAddress: marketStateDecodedData.ownAddress.toString(),
                            marketStateVaultSignerNonce: marketStateDecodedData.vaultSignerNonce.toString(),
                            marketStateBaseMint: marketStateDecodedData.baseMint.toString(),
                            marketStateQuoteMint: marketStateDecodedData.quoteMint.toString(),
                            marketStateBaseVault: marketStateDecodedData.baseVault.toString(),
                            marketStateBaseDepositsTotal: marketStateDecodedData.baseDepositsTotal.toString(),
                            marketStateBaseFeesAccrued: marketStateDecodedData.baseFeesAccrued.toString(),
                            marketStateQuoteVault: marketStateDecodedData.quoteVault.toString(),
                            marketStateQuoteDepositsTotal: marketStateDecodedData.quoteDepositsTotal.toString(),
                            marketStateQuoteFeesAccrued: marketStateDecodedData.quoteFeesAccrued.toString(),
                            marketStateQuoteDustThreshold: marketStateDecodedData.quoteDustThreshold.toString(),
                            marketStateRequestQueue: marketStateDecodedData.requestQueue.toString(),
                            marketStateEventQueue: marketStateDecodedData.eventQueue.toString(),
                            marketStateBids: marketStateDecodedData.bids.toString(),
                            marketStateAsks: marketStateDecodedData.asks.toString(),
                            marketStateBaseLotSize: marketStateDecodedData.baseLotSize.toString(),
                            marketStateQuoteLotSize: marketStateDecodedData.quoteLotSize.toString(),
                            marketStateFeeRateBps: marketStateDecodedData.feeRateBps.toString(),
                            marketStateReferrerRebatesAccrued: marketStateDecodedData.referrerRebatesAccrued.toString(),

                            // // Amm Account Decoded Pool State Data
                            // status: <BN: 6>,
                            // nonce: <BN: fe>,
                            // maxOrder: <BN: 7>,
                            // depth: <BN: 3>,
                            // baseDecimal: <BN: 6>,
                            // quoteDecimal: <BN: 9>,
                            // state: <BN: 1>,
                            // resetFlag: <BN: 0>,
                            // minSize: <BN: 3b9aca00>,
                            // volMaxCutRatio: <BN: 1f4>,
                            // amountWaveRatio: <BN: 4c4b40>,
                            // baseLotSize: <BN: f4240>,
                            // quoteLotSize: <BN: 989680>,
                            // minPriceMultiplier: <BN: 1>,
                            // maxPriceMultiplier: <BN: 3b9aca00>,
                            // systemDecimalValue: <BN: 3b9aca00>,
                            // minSeparateNumerator: <BN: 5>,
                            // minSeparateDenominator: <BN: 2710>,
                            // tradeFeeNumerator: <BN: 19>,
                            // tradeFeeDenominator: <BN: 2710>,
                            // pnlNumerator: <BN: c>,
                            // pnlDenominator: <BN: 64>,
                            // swapFeeNumerator: <BN: 19>,
                            // swapFeeDenominator: <BN: 2710>,
                            // baseNeedTakePnl: <BN: c945e5>,
                            // quoteNeedTakePnl: <BN: 587>,
                            // quoteTotalPnl: <BN: b94e28cba>,
                            // baseTotalPnl: <BN: fb79e1d7f4>,
                            // poolOpenTime: <BN: 67b2d013>,
                            // punishPcAmount: <BN: 0>,
                            // punishCoinAmount: <BN: 0>,
                            // orderbookToInitTime: <BN: 0>,
                            // swapBaseInAmount: <BN: 741f6dc4c6edf>,
                            // swapQuoteOutAmount: <BN: 100b65d97acc>,
                            // swapBase2QuoteFee: <BN: a43faf122>,
                            // swapQuoteInAmount: <BN: 100a37f41580>,
                            // swapBaseOutAmount: <BN: 6f0532c80f0a9>,
                            // swapQuote2BaseFee: <BN: 4a518df0221>,
                            // baseVault: PublicKey [PublicKey(As9PoxWdzhdzCZrENXNSoaZP9CPKcjQYpSBu4prZA8qj)] {
                            //     _bn: <BN: 9291b68d1940f273a6e8c8d9c3b3d55d5f0c919dbc15e1949341328e9182414e>
                            // },
                            // quoteVault: PublicKey [PublicKey(C6gUtZV3kppeU22QFUv462AvfG2xuY8xit6FcNKz5ZtW)] {
                            //     _bn: <BN: a4e519f3439807f24409104089c6b488579c90793fd679a24ea85360c64d2d5b>
                            // },
                            // baseMint: PublicKey [PublicKey(FCK8PzfFaueVJEVZcy2q53yozr6QTYhaFixEaBNEa7YP)] {
                            //     _bn: <BN: d2e980b2b147ad08e0c3b351e27835fa97f147f41954ea95a01eab359459e50c>
                            // },
                            // quoteMint: PublicKey [PublicKey(So11111111111111111111111111111111111111112)] {
                            //     _bn: <BN: 69b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001>
                            // },
                            // lpMint: PublicKey [PublicKey(3J1R41U3q8Nw45564acWa3pEkfBW9cuL1g2NxThogt6S)] {
                            //     _bn: <BN: 2212b76c3df92d59109faf6101df2721218abd134af1ac0e61e32209493ad45f>
                            // },
                            // openOrders: PublicKey [PublicKey(F7JDA1xqVUN8Ap4jeGwevv3uR3uuT4cHUziYE8GUQpD6)] {
                            //     _bn: <BN: d1a08f8d92cbdd8a1e53362502545498a6b007e25d1a3014bf0468c03a2c6441>
                            // },
                            // marketId: PublicKey [PublicKey(EKxFqYxizorZLMXbJTCo5cBx4E2PHZ5bdRyiNt8Y62Vn)] {
                            //     _bn: <BN: c602dcd02df7e89e2d9164760dddb7c8b3af75e724f1884bcc0a7876ea681701>
                            // },
                            // marketProgramId: PublicKey [PublicKey(srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX)] {
                            //     _bn: <BN: d0751a8282da61305fe299c37b998e58471db1135037310f8be1045a60af6ee>
                            // },
                            // targetOrders: PublicKey [PublicKey(FE4BRqwQ5GYTaY5m5t9MyYMJK642Viw5WpLKgAmP4A34)] {
                            //     _bn: <BN: d35bc34d38fe4ab410c5249d011036e64dc681b64a703c91a7ebb7c8c6c311d3>
                            // },
                            // withdrawQueue: PublicKey [PublicKey(11111111111111111111111111111111)] {
                            //     _bn: <BN: 0>
                            // },
                            // lpVault: PublicKey [PublicKey(11111111111111111111111111111111)] {
                            //     _bn: <BN: 0>
                            // },
                            // owner: PublicKey [PublicKey(GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ)] {
                            //     _bn: <BN: e5b62b65cb3bbda6f56888e66fee8e64dc5560199c0f88b11fe273bd059e8aa1>
                            // },
                            // lpReserve: <BN: f4240>,
                            // padding: [ <BN: 0>, <BN: 2ec>, <BN: 0> ]

                            liquidityStateStatus: ammAccountDecodedPoolStateData.status.toString(),
                            liquidityStateNonce: ammAccountDecodedPoolStateData.nonce.toString(),
                            liquidityStateMaxOrder: ammAccountDecodedPoolStateData.maxOrder.toString(),
                            liquidityStateDepth: ammAccountDecodedPoolStateData.depth.toString(),
                            liquidityStateBaseDecimal: ammAccountDecodedPoolStateData.baseDecimal.toString(),
                            liquidityStateQuoteDecimal: ammAccountDecodedPoolStateData.quoteDecimal.toString(),
                            liquidityStateState: ammAccountDecodedPoolStateData.state.toString(),
                            liquidityStateResetFlag: ammAccountDecodedPoolStateData.resetFlag.toString(),
                            liquidityStateMinSize: ammAccountDecodedPoolStateData.minSize.toString(),
                            liquidityStateVolMaxCutRatio: ammAccountDecodedPoolStateData.volMaxCutRatio.toString(),
                            liquidityStateAmountWaveRatio: ammAccountDecodedPoolStateData.amountWaveRatio.toString(),
                            liquidityStateBaseLotSize: ammAccountDecodedPoolStateData.baseLotSize.toString(),
                            liquidityStateQuoteLotSize: ammAccountDecodedPoolStateData.quoteLotSize.toString(),
                            liquidityStateMinPriceMultiplier: ammAccountDecodedPoolStateData.minPriceMultiplier.toString(),
                            liquidityStateMaxPriceMultiplier: ammAccountDecodedPoolStateData.maxPriceMultiplier.toString(),
                            liquidityStateSystemDecimalValue: ammAccountDecodedPoolStateData.systemDecimalValue.toString(),
                            liquidityStateMinSeparateNumerator: ammAccountDecodedPoolStateData.minSeparateNumerator.toString(),
                            liquidityStateMinSeparateDenominator: ammAccountDecodedPoolStateData.minSeparateDenominator.toString(),
                            liquidityStateTradeFeeNumerator: ammAccountDecodedPoolStateData.tradeFeeNumerator.toString(),
                            liquidityStateTradeFeeDenominator: ammAccountDecodedPoolStateData.tradeFeeDenominator.toString(),
                            liquidityStatePnlNumerator: ammAccountDecodedPoolStateData.pnlNumerator.toString(),
                            liquidityStatePnlDenominator: ammAccountDecodedPoolStateData.pnlDenominator.toString(),
                            liquidityStateSwapFeeNumerator: ammAccountDecodedPoolStateData.swapFeeNumerator.toString(),
                            liquidityStateSwapFeeDenominator: ammAccountDecodedPoolStateData.swapFeeDenominator.toString(),
                            liquidityStateBaseNeedTakePnl: ammAccountDecodedPoolStateData.baseNeedTakePnl.toString(),
                            liquidityStateQuoteNeedTakePnl: ammAccountDecodedPoolStateData.quoteNeedTakePnl.toString(),
                            liquidityStateQuoteTotalPnl: ammAccountDecodedPoolStateData.quoteTotalPnl.toString(),
                            liquidityStateBaseTotalPnl: ammAccountDecodedPoolStateData.baseTotalPnl.toString(),
                            liquidityStatePoolOpenTime: ammAccountDecodedPoolStateData.poolOpenTime.toString(),
                            liquidityStatePunishPcAmount: ammAccountDecodedPoolStateData.punishPcAmount.toString(),
                            liquidityStatePunishCoinAmount: ammAccountDecodedPoolStateData.punishCoinAmount.toString(),
                            liquidityStateOrderbookToInitTime: ammAccountDecodedPoolStateData.orderbookToInitTime.toString(),
                            liquidityStateSwapBaseInAmount: ammAccountDecodedPoolStateData.swapBaseInAmount.toString(),
                            liquidityStateSwapQuoteOutAmount: ammAccountDecodedPoolStateData.swapQuoteOutAmount.toString(),
                            liquidityStateSwapBase2QuoteFee: ammAccountDecodedPoolStateData.swapBase2QuoteFee.toString(),
                            liquidityStateSwapQuoteInAmount: ammAccountDecodedPoolStateData.swapQuoteInAmount.toString(),
                            liquidityStateSwapBaseOutAmount: ammAccountDecodedPoolStateData.swapBaseOutAmount.toString(),
                            liquidityStateSwapQuote2BaseFee: ammAccountDecodedPoolStateData.swapQuote2BaseFee.toString(),
                            liquidityStateBaseVault: ammAccountDecodedPoolStateData.baseVault.toString(),
                            liquidityStateQuoteVault: ammAccountDecodedPoolStateData.quoteVault.toString(),
                            liquidityStateBaseMint: ammAccountDecodedPoolStateData.baseMint.toString(),
                            liquidityStateQuoteMint: ammAccountDecodedPoolStateData.quoteMint.toString(),
                            liquidityStateLpMint: ammAccountDecodedPoolStateData.lpMint.toString(),
                            liquidityStateOpenOrders: ammAccountDecodedPoolStateData.openOrders.toString(),
                            liquidityStateMarketId: ammAccountDecodedPoolStateData.marketId.toString(),
                            liquidityStateMarketProgramId: ammAccountDecodedPoolStateData.marketProgramId.toString(),
                            liquidityStateTargetOrders: ammAccountDecodedPoolStateData.targetOrders.toString(),
                            liquidityStateWithdrawQueue: ammAccountDecodedPoolStateData.withdrawQueue.toString(),
                            liquidityStateLpVault: ammAccountDecodedPoolStateData.lpVault.toString(),
                            liquidityStateOwner: ammAccountDecodedPoolStateData.owner.toString(),
                            liquidityStateLpReserve: ammAccountDecodedPoolStateData.lpReserve.toString(),
                            liquidityStatePadding: ammAccountDecodedPoolStateData.padding.map(element => element.toString()),

                            // // current price of token

                        };
                    }
                }
            } catch (error) {
                console.log("🚀 ~ SolanaService ~ returnthis.retry ~ error:", error);
                throw error;
            }
            
        });
    }

    // // getTokenPriceOnRaydium
    // async getTokenPriceOnRaydium(tokenAddress: string) {
    //     const raydium = new Raydium();
    //     const tokenInfo = await raydium.getTokenInfo(tokenAddress);
    //     return tokenInfo;
    // }

    // getAllTokenAccountsWithRaydiumPrices
    async getAllTokenAccountsWithRaydiumPrices(owner: string) {
        return this.retry(async () => {
            const ownerPublicKey = new PublicKey(owner);
            const connection = await this.getConnectionWithFallback();
            const tokenAccounts = (await connection.getParsedTokenAccountsByOwner(ownerPublicKey, { programId: TOKEN_PROGRAM_ID })).value;

            let tokenAccountsObj = [];

            // print token mint, owner, tokenATA amount, decimals
            tokenAccounts.forEach(tokenAccount => {
                let obj = {
                    mint: tokenAccount.account.data.parsed.info.mint,
                    owner: tokenAccount.account.data.parsed.info.owner,
                    tokenATA: tokenAccount.pubkey,
                    amount: tokenAccount.account.data.parsed.info.tokenAmount.uiAmountString,
                    decimals: tokenAccount.account.data.parsed.info.tokenAmount.decimals,
                }
                tokenAccountsObj.push(obj);
            });

            let tokenAddresses = [];
            for (let i = 0; i < tokenAccountsObj.length; i++) {
                let tokenAccount = tokenAccountsObj[i];
                tokenAddresses.push(tokenAccount.mint);
            }
            try {
                console.log(
                    `Fetching prices and volume for token addresses: ${tokenAddresses.join(', ')}`,
                );
                const url = `https://api.raydium.io/v2/main/pairs`; // Raydium's pairs endpoint
                const response = await axios.get(url);
                const pairs = response.data;

                const prices = [];

                // Iterate through each token address and fetch its price and volume
                for (const tokenAddress of tokenAddresses) {
                    try {
                        // Find the token pair where the tokenAddress is either in baseMint or quoteMint
                        const tokenPair = pairs.find(
                            (pair) =>
                                (pair.baseMint === tokenAddress || pair.quoteMint === tokenAddress) &&
                                (pair.baseMint === 'So11111111111111111111111111111111111111112' ||
                                    pair.quoteMint === 'So11111111111111111111111111111111111111112'),
                        );

                        if (!tokenPair) {
                            console.log(`Token pair not found for address: ${tokenAddress}`);
                            continue; // Skip to the next token address
                        }

                        const price1solXtoken = tokenPair.price; // Price as a string
                        // console.log(
                        //     '🚀 ~ DexScreenerService ~ getTokenPrice ~ price1solXtoken:',
                        //     price1solXtoken,
                        // );

                        let resultWithPrecision;

                        if (tokenPair.quoteMint === tokenAddress) {
                            // If address is found in quoteMint, perform the calculation
                            const a = new Decimal('1'); // Decimal for 1
                            const b = new Decimal(price1solXtoken); // Price as a Decimal

                            const precision = 18; // Desired precision

                            // Perform the division directly with decimal.js
                            const result = a.div(b);

                            // Adjust the result to the desired precision and convert it to a string
                            resultWithPrecision = result.toFixed(precision); // 18 decimal places

                            // Convert result to a readable format
                            resultWithPrecision = new Decimal(resultWithPrecision).toFixed(
                                precision,
                                Decimal.ROUND_DOWN,
                            );

                            // console.log('Result with precision:', resultWithPrecision); // Result as a string with 18 decimal places
                        } else {
                            // If address is found in baseMint, return the price as is
                            resultWithPrecision = price1solXtoken;
                        }

                        // Ensure the result is in a readable format (not scientific notation)
                        resultWithPrecision = parseFloat(resultWithPrecision).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 18 },
                        );

                        // Get the 24-hour volume in USD
                        const volume24h = parseFloat(tokenPair.volume24h || '0');
                        const formattedVolume24h =
                            volume24h > 0 ? volume24h.toFixed(2) : 'No volume data'; // Fallback to message

                        // Get the volume for the last 7 days
                        const volume7d = tokenPair.volume7d
                            ? parseFloat(tokenPair.volume7d)
                            : 0; // Use 7-day volume if available
                        const formattedVolume7d =
                            volume7d > 0 ? volume7d.toFixed(2) : 'No volume data'; // Fallback to message

                        // Get the volume for the last 30 days
                        const volume30d = parseFloat(tokenPair.volume30d || '0');
                        const formattedVolume30d =
                            volume30d > 0 ? volume30d.toFixed(2) : 'No volume data'; // Fallback to message

                        const ammid = tokenPair.ammId;
                        console.log('🚀 ~ DexScreenerService ~ getTokendetails ~ ammid:', ammid);

                        // get mint details in tokenAccountObj
                        let mintDetails = tokenAccountsObj.find(tokenAccount => tokenAccount.mint === tokenAddress);
                        // console.log("mintDetails", mintDetails);

                        // Push the result for the current token into the prices array
                        prices.push({
                            tokenAddress,
                            price: resultWithPrecision,
                            ammid: ammid,
                            pricegivebyraydium: price1solXtoken,
                            volume24h: formattedVolume24h,
                            volume7d: formattedVolume7d,
                            volume30d: formattedVolume30d,
                            baseSymbol: tokenPair.baseSymbol,
                            quoteSymbol: tokenPair.quoteSymbol,

                            owner: mintDetails.owner,
                            tokenATA: mintDetails.tokenATA,
                            amount: mintDetails.amount,
                            decimals: mintDetails.decimals
                        });
                    } catch (innerError) {
                        // Catch any error related to a single token, log it, and continue with the next
                        console.error(`Error processing token address ${tokenAddress}: ${innerError.message}`);
                        continue; // Skip to the next token address
                    }
                }

                return prices;
            } catch (error) {
                console.error(
                    `Error fetching prices and volumes for token addresses: ${error.message}`,
                );
                throw error;
            }
        });
    }

    // getRaydiumPairsWithRaydiumPrices -> getAMMId
    async getRaydiumPairsWithRaydiumPrices(tokenAddresses: string[]): Promise<any[]> {
        return this.retry(async () => {
            try {
                console.log(
                    `Fetching prices and volume for token addresses: ${tokenAddresses.join(', ')}`,
                );
                const url = `https://api.raydium.io/v2/main/pairs`; // Raydium's pairs endpoint
                const response = await axios.get(url);
                const pairs = response.data;

                const prices: any[] = [];

                // Iterate through each token address and fetch its price and volume
                for (const tokenAddress of tokenAddresses) {
                    try {
                        // Find the token pair where the tokenAddress is either in baseMint or quoteMint
                        const tokenPair = pairs.find(
                            (pair) =>
                                (pair.baseMint === tokenAddress || pair.quoteMint === tokenAddress) &&
                                (pair.baseMint === 'So11111111111111111111111111111111111111112' ||
                                    pair.quoteMint === 'So11111111111111111111111111111111111111112'),
                        );

                        if (!tokenPair) {
                            console.log(`Token pair not found for address: ${tokenAddress}`);
                            continue; // Skip to the next token address
                        }

                        const price1solXtoken: string = tokenPair.price; // Price as a string
                        console.log(
                            '🚀 ~ DexScreenerService ~ getTokenPrice ~ price1solXtoken:',
                            price1solXtoken,
                        );

                        let resultWithPrecision: string;

                        if (tokenPair.quoteMint === tokenAddress) {
                            // If address is found in quoteMint, perform the calculation
                            const a = new Decimal('1'); // Decimal for 1
                            const b = new Decimal(price1solXtoken); // Price as a Decimal

                            const precision = 18; // Desired precision

                            // Perform the division directly with decimal.js
                            const result = a.div(b);

                            // Adjust the result to the desired precision and convert it to a string
                            resultWithPrecision = result.toFixed(precision); // 18 decimal places

                            // Convert result to a readable format
                            resultWithPrecision = new Decimal(resultWithPrecision).toFixed(
                                precision,
                                Decimal.ROUND_DOWN,
                            );

                            console.log('Result with precision:', resultWithPrecision); // Result as a string with 18 decimal places
                        } else {
                            // If address is found in baseMint, return the price as is
                            resultWithPrecision = price1solXtoken;
                        }

                        // Ensure the result is in a readable format (not scientific notation)
                        resultWithPrecision = parseFloat(resultWithPrecision).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 18 },
                        );

                        // Get the 24-hour volume in USD
                        const volume24h: number = parseFloat(tokenPair.volume24h || '0');
                        const formattedVolume24h: string =
                            volume24h > 0 ? volume24h.toFixed(2) : 'No volume data'; // Fallback to message

                        // Get the volume for the last 7 days
                        const volume7d: number = tokenPair.volume7d
                            ? parseFloat(tokenPair.volume7d)
                            : 0; // Use 7-day volume if available
                        const formattedVolume7d: string =
                            volume7d > 0 ? volume7d.toFixed(2) : 'No volume data'; // Fallback to message

                        // Get the volume for the last 30 days
                        const volume30d: number = parseFloat(tokenPair.volume30d || '0');
                        const formattedVolume30d: string =
                            volume30d > 0 ? volume30d.toFixed(2) : 'No volume data'; // Fallback to message

                        const ammid: string = tokenPair.ammId;
                        console.log('🚀 ~ DexScreenerService ~ getTokendetails ~ ammid:', ammid);

                        // Push the result for the current token into the prices array
                        prices.push({
                            tokenAddress,
                            price: resultWithPrecision,
                            ammid: ammid,
                            pricegivebyraydium: price1solXtoken,
                            volume24h: formattedVolume24h,
                            volume7d: formattedVolume7d,
                            volume30d: formattedVolume30d,
                            baseSymbol: tokenPair.baseSymbol,
                            quoteSymbol: tokenPair.quoteSymbol,
                        });
                    } catch (innerError) {
                        // Catch any error related to a single token, log it, and continue with the next
                        console.error(`Error processing token address ${tokenAddress}: ${innerError.message}`);
                        continue; // Skip to the next token address
                    }
                }

                return prices;
            } catch (error) {
                console.error(
                    `Error fetching prices and volumes for token addresses: ${error.message}`,
                );
                throw error;
            }
        });
    }

    // getInputAndOutputTokenQtyFromTxReceiptPostSwap
    async getInputAndOutputTokenQtyFromTxReceiptPostSwap(transactionHash: string, owner: string) {
        return this.retry(async () => {
            const result1 = await this.getPreAndPostTokenBalance(transactionHash, owner);
            const result1SolBalance = await this.getPreAndPostSolanaBalance(transactionHash, owner);

            const ataCreationFee = await this.findATACreationFee(transactionHash, owner);

            const owner2 = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1" // fix raydium authority
            const result2 = await this.getPreAndPostTokenBalance(transactionHash, owner2);

            // now aggregate the results to common object, if inputToken is null, then use outputToken
            const aggregatedResult = {
                inputToken: result1.inputToken ? result1.inputToken : result2.outputToken,
                outputToken: result1.outputToken ? result1.outputToken : result2.inputToken,
                solCostToUser: result1SolBalance.changeInSol,
                gasFeeInLamports: result1SolBalance.gasFeeInLamports,
                gasFeeInSol: result1SolBalance.gasFeeInSol,
                ataCreationFeeInLamports: ataCreationFee.ataCreationFeeInLamports,
                ataCreationFeeInSol: ataCreationFee.ataCreationFeeInSol,
                timestamp: result1.timestamp ? result1.timestamp : result2.timestamp
            };
            return aggregatedResult;
        });
    }

    // // ix_swapRaydium
    // async ix_swapRaydium(ammId: string, amount: number, owner: string) {
    //     let ownerPublicKey = new PublicKey(owner);
    //     let ammIdPublicKey = new PublicKey(ammId);
    //     let swapIx = createSwapInstruction(ammIdPublicKey, ownerPublicKey, amount, TOKEN_PROGRAM_ID)
    //     return swapIx.toString();
    // }

}