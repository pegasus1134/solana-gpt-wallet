import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
    LAMPORTS_PER_SOL,
    Transaction,
    SystemProgram,
    PublicKey,
    Connection,
} from '@solana/web3.js';
import { useWalletStore } from '@/stores/useWalletStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClientWalletButton } from '@/components/ClientWalletButton';
import { handleSolanaError } from '@/utils/error-handlers';
import { RecentTransactions } from '@/components/transactions/RecentTransactions';
import { formatAddress, getExplorerUrl, sleep } from '@/utils/wallet-utils';
import {
    Wallet,
    ArrowUpRight,
    ArrowDownLeft,
    RefreshCcw,
    Command,
    Sparkles,
    Loader2,
    Copy,
    ExternalLink,
    AlertCircle,
    Check,
    X,
    AlertOctagon,
    AlertTriangle,
} from 'lucide-react';

// Use your RPC endpoint (set via NEXT_PUBLIC_SOLANA_RPC_URL)
const FREE_RPC_URL =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    'https://quick-snowy-spring.solana-mainnet.quiknode.pro/b8555444cea75763a432668664ab36f1d6dd64e0';
// USDC mint address on mainnet
const MAINNET_USDC_MINT = new PublicKey(
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
);

const connectionConfig = {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
    disableRetryOnRateLimit: false,
    fetch: (url: string, options: any) => {
        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Origin': 'https://explorer.solana.com',
            },
        });
    },
};

type TransactionError = {
    type: 'error' | 'warning';
    message: string;
    details?: string;
};

// This type represents the command returned by the API route.
export interface WalletCommand {
    action: 'send' | 'receive' | 'check_balance' | 'ask_address' | 'confirm_transaction' | 'show_history' | 'swap';
    amount?: number;
    toAddress?: string;
    fromToken?: string;
    toToken?: string;
    message: string;
    requiresConfirmation?: boolean;
    needsMoreInfo?: boolean;
    formattedAmount?: string;
    error?: string;
};

import TransactionConfirmation from '@/components/TransacationConfirmation';

const WalletDashboard: React.FC = () => {
    const customConnection = useMemo(
        () => new Connection(FREE_RPC_URL, connectionConfig),
        []
    );
    const { publicKey, sendTransaction } = useWallet();
    const { balance, setBalance, setError } = useWalletStore();

    // Local state variables.
    const [input, setInput] = useState('');
    const [processing, setProcessing] = useState(false);
    const [response, setResponse] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [showBalance, setShowBalance] = useState(false);
    const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
    const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
    const [pendingTransaction, setPendingTransaction] = useState<WalletCommand | null>(null);
    const [transactionError, setTransactionError] = useState<TransactionError | null>(null);
    const [transactionInProgress, setTransactionInProgress] = useState(false);
    const [showMainnetWarning, setShowMainnetWarning] = useState(true);
    const [usdcBalance, setUsdcBalance] = useState<number>(0);

    // Clear errors after 5 seconds.
    useEffect(() => {
        let timeoutId: NodeJS.Timeout;
        if (transactionError) {
            timeoutId = setTimeout(() => setTransactionError(null), 5000);
        }
        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [transactionError]);

    // Update balances and transactions on wallet connection changes.
    useEffect(() => {
        if (publicKey) {
            updateBalance();
            updateUsdcBalance();
            fetchRecentTransactions();
            setShowBalance(true);
        } else {
            setBalance(0);
            setUsdcBalance(0);
            setRecentTransactions([]);
            setShowBalance(false);
            setPendingTransaction(null);
            setTransactionError(null);
        }
    }, [publicKey]);

    const updateBalance = async () => {
        if (!publicKey) return;
        try {
            const balanceLamports = await customConnection.getBalance(publicKey);
            setBalance(balanceLamports / LAMPORTS_PER_SOL);
        } catch (error) {
            console.error('Error fetching balance:', error);
            setError('Failed to fetch balance');
            setBalance(0);
        }
    };

    const updateUsdcBalance = async () => {
        if (!publicKey) return;
        try {
            const tokenAccounts = await customConnection.getParsedTokenAccountsByOwner(publicKey, {
                mint: MAINNET_USDC_MINT,
            });
            if (tokenAccounts.value.length === 0) {
                setUsdcBalance(0);
                return;
            }
            const account = tokenAccounts.value[0];
            const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
            setUsdcBalance(amount || 0);
        } catch (error) {
            console.error('Error fetching USDC balance:', error);
            setUsdcBalance(0);
        }
    };

    const fetchRecentTransactions = async () => {
        if (!publicKey || isLoadingTransactions) return;
        setIsLoadingTransactions(true);
        try {
            const signatures = await customConnection.getSignaturesForAddress(publicKey, { limit: 5 });
            setRecentTransactions(signatures);
        } catch (error) {
            console.error('Error fetching transactions:', error);
            setResponse('Failed to fetch recent transactions.');
            setRecentTransactions([]);
        } finally {
            setIsLoadingTransactions(false);
        }
    };

    const validateTransaction = useCallback(
        (amount: number): boolean => {
            if (amount <= 0) {
                setTransactionError({
                    type: 'error',
                    message: 'Invalid amount',
                    details: 'Amount must be greater than 0',
                });
                return false;
            }
            if (amount > balance) {
                setTransactionError({
                    type: 'error',
                    message: 'Insufficient balance',
                    details: `You need ${amount} SOL but only have ${balance.toFixed(4)} SOL`,
                });
                return false;
            }
            return true;
        },
        [balance]
    );

    // Process natural language commands via the API route.
    const processCommand = async (): Promise<WalletCommand> => {
        const payload = {
            input,
            publicKey: publicKey.toString(),
            balance,
        };

        const res = await fetch('/api/process-command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`API error: ${res.status} ${errorText}`);
        }

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await res.text();
            throw new Error(`Expected JSON but got: ${text}`);
        }

        const data = await res.json();
        return data.result;
    };

    // Build and send a transfer transaction using the connected wallet.
    const executeTransaction = async (command: WalletCommand) => {
        if (!publicKey || !command.toAddress || !command.amount) return;
        if (!validateTransaction(command.amount)) {
            setPendingTransaction(null);
            return;
        }
        setTransactionInProgress(true);
        try {
            const toPublicKey = new PublicKey(command.toAddress);
            if (toPublicKey.equals(publicKey)) {
                throw new Error('Cannot send SOL to your own address');
            }
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: toPublicKey,
                    lamports: Math.floor(command.amount * LAMPORTS_PER_SOL),
                })
            );
            const latestBlockhash = await customConnection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = publicKey;
            const signature = await sendTransaction(transaction, customConnection);
            setResponse(`Transaction sent! Signature: ${signature}`);
            await sleep(1000);
            await updateBalance();
            await fetchRecentTransactions();
        } catch (error: any) {
            const errorResult = handleSolanaError(error);
            setTransactionError({
                type: 'error',
                message: 'Transaction failed',
                details: errorResult.message,
            });
        } finally {
            setTransactionInProgress(false);
            setPendingTransaction(null);
        }
    };

    // When the user confirms a pending "send" transaction.
    const onConfirmTransaction = () => {
        if (pendingTransaction) {
            executeTransaction(pendingTransaction);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !publicKey) return;

        setProcessing(true);
        setIsTyping(true);
        setTransactionError(null);

        try {
            const gptResponse = await processCommand();
            // For simplicity, we only handle "send" commands.
            if (gptResponse.action === 'send') {
                if (gptResponse.amount && gptResponse.toAddress) {
                    if (validateTransaction(gptResponse.amount)) {
                        setPendingTransaction(gptResponse);
                    }
                }
            } else if (gptResponse.action === 'check_balance') {
                await updateBalance();
                await updateUsdcBalance();
            } else if (gptResponse.action === 'show_history') {
                await fetchRecentTransactions();
            }
            if (gptResponse.error) {
                setTransactionError({ type: 'warning', message: gptResponse.error });
            }
            setResponse(gptResponse.message);
        } catch (error) {
            console.error('Error processing command:', error);
            setResponse('Sorry, I encountered an error processing your request.');
            setTransactionError({
                type: 'error',
                message: 'Processing Error',
                details: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setIsTyping(false);
            setProcessing(false);
            if (!pendingTransaction) {
                setInput('');
            }
        }
    };

    if (!publicKey) {
        return (
            <div className="relative min-h-screen bg-gradient-to-b from-black via-gray-900 to-black flex items-center justify-center">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-[300px] h-[300px] bg-cyan-500/5 rounded-full animate-pulse" />
                    <div className="absolute w-[500px] h-[500px] bg-cyan-500/5 rounded-full animate-pulse delay-75" />
                </div>
                <div className="relative z-10 text-center space-y-8 p-8 backdrop-blur-xl bg-black/30 rounded-2xl border border-gray-800 shadow-2xl max-w-lg mx-4">
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                        <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
                        <p className="text-red-400 font-medium">
                            Mainnet Environment - Real Transactions
                        </p>
                    </div>
                    <div className="flex justify-center">
                        <div className="p-3 rounded-full bg-cyan-500/10 border border-cyan-500/20 animate-bounce">
                            <Wallet className="w-12 h-12 text-cyan-400" />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
                            Welcome to Solana GPT Wallet
                        </h1>
                        <p className="text-gray-400 max-w-sm mx-auto">
                            Your AI-powered gateway to Solana. Connect your wallet to manage assets with natural language.
                        </p>
                    </div>
                    <div className="space-y-4">
                        <div className="p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/20 backdrop-blur-sm">
                            <div className="mb-3 text-sm text-cyan-300 font-medium">
                                Connect Wallet to Start
                            </div>
                            <div className="welcome-wallet-button">
                                <ClientWalletButton />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen bg-gradient-to-b from-black via-gray-900 to-black">
            <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
            <div className="relative w-full max-w-4xl mx-auto p-4 pt-20">
                <div className="backdrop-blur-xl bg-black/30 rounded-2xl border border-gray-800 shadow-2xl p-8">
                    <div className="flex justify-between items-center mb-8">
                        <div className="flex items-center gap-3">
                            <Wallet className="w-8 h-8 text-cyan-400" />
                            <div>
                                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
                                    Solana GPT Wallet
                                </h1>
                                <p className="text-xs text-cyan-500">Mainnet</p>
                            </div>
                        </div>
                        <ClientWalletButton />
                    </div>
                    {showMainnetWarning && (
                        <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-red-400" />
                                <div className="flex-1">
                                    <p className="text-red-400">
                                        You are on Solana Mainnet. All transactions use real funds.
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowMainnetWarning(false)}
                                    className="text-red-400 hover:text-red-300"
                                >
                                    Dismiss
                                </Button>
                            </div>
                        </div>
                    )}
                    {transactionError && (
                        <div
                            className={`mb-4 p-4 rounded-lg border ${
                                transactionError.type === 'error'
                                    ? 'bg-red-500/10 border-red-500/50 text-red-400'
                                    : 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <AlertOctagon className="w-5 h-5 mt-0.5" />
                                <div>
                                    <p className="font-medium">{transactionError.message}</p>
                                    {transactionError.details && (
                                        <p className="text-sm opacity-80 mt-1">{transactionError.details}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-black to-gray-900 p-8 mb-8">
                        <div className="absolute inset-0 bg-grid-white/10 pointer-events-none" />
                        <div className={`transition-all duration-1000 transform ${showBalance ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-6">
                                        <p className="text-gray-400">Wallet Balance</p>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                                updateBalance();
                                                updateUsdcBalance();
                                            }}
                                            className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20"
                                        >
                                            <RefreshCcw className="w-4 h-4" />
                                        </Button>
                                    </div>
                                    <div className="grid gap-4">
                                        <div className="p-4 rounded-lg bg-black/40 border border-gray-800/50">
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm text-gray-400 mb-1">SOL</p>
                                                    <p className="text-2xl font-bold text-white">{balance.toFixed(4)}</p>
                                                </div>
                                                <div className="text-xs text-gray-500">Native Token</div>
                                            </div>
                                        </div>
                                        <div className="p-4 rounded-lg bg-black/40 border border-gray-800/50">
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm text-gray-400 mb-1">USDC</p>
                                                    <p className="text-2xl font-bold text-white">{usdcBalance.toFixed(2)}</p>
                                                </div>
                                                <div className="text-xs text-gray-500">Stablecoin</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-6">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-gray-500 bg-black/40 px-2 py-1 rounded-md border border-gray-800">
                                                {formatAddress(publicKey.toString())}
                                            </p>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 bg-black/40 hover:bg-gray-800/40"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(publicKey.toString());
                                                    setResponse('Address copied to clipboard!');
                                                }}
                                            >
                                                <Copy className="h-3.5 w-3.5 text-gray-400" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 mt-6">
                                        <Button
                                            variant="outline"
                                            onClick={() => setInput('send')}
                                            className="flex-1 flex items-center justify-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/20 text-white"
                                        >
                                            <ArrowUpRight className="w-4 h-4" />
                                            Send
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => setInput('swap')}
                                            className="flex-1 flex items-center justify-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/20 text-white"
                                        >
                                            <RefreshCcw className="w-4 h-4" />
                                            Swap
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => {
                                                navigator.clipboard.writeText(publicKey.toString());
                                                setResponse('Address copied! Share this to receive tokens.');
                                            }}
                                            className="flex-1 flex items-center justify-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/20 text-white"
                                        >
                                            <ArrowDownLeft className="w-4 h-4" />
                                            Receive
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-gray-400 mb-4">
                            <Command className="w-5 h-5" />
                            <p>Ask me anything about your wallet</p>
                        </div>
                        <form onSubmit={handleSubmit} className="relative">
                            <Input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="e.g. 'Send 0.1 SOL to ...', 'Swap 0.5 SOL to USDC', 'Check my balance', 'Show recent transactions'"
                                className="bg-black/40 border-gray-800 text-white placeholder:text-gray-500"
                                disabled={processing || transactionInProgress}
                            />
                            <Button
                                type="submit"
                                variant="ghost"
                                size="icon"
                                disabled={processing || !input.trim() || transactionInProgress}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20"
                            >
                                {processing ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <Sparkles className="w-5 h-5" />
                                )}
                            </Button>
                        </form>
                        {(response || isTyping) && (
                            <div className="mt-4 p-4 rounded-lg bg-black/40 border border-gray-800">
                                {isTyping ? (
                                    <div className="flex gap-1">
                                        <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" />
                                        <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                                        <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                                    </div>
                                ) : (
                                    <p className="text-gray-300">{response}</p>
                                )}
                            </div>
                        )}
                        {pendingTransaction && pendingTransaction.action === 'send' && (
                            <TransactionConfirmation
                                amount={pendingTransaction.amount!}
                                toAddress={pendingTransaction.toAddress!}
                                onConfirm={onConfirmTransaction}
                                onCancel={() => {
                                    setPendingTransaction(null);
                                    setResponse('Transaction cancelled by user.');
                                }}
                            />
                        )}
                        {pendingTransaction && pendingTransaction.action === 'swap' && (
                            <div className="mt-4 p-4 rounded-lg bg-black/40 border border-yellow-500/50">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
                                    <div className="space-y-2 flex-1">
                                        <h4 className="font-medium text-white">Confirm Swap</h4>
                                        <div className="space-y-1 text-sm text-gray-400">
                                            <p>
                                                From:{' '}
                                                <span className="text-white">
                          {pendingTransaction.formattedAmount}
                        </span>{' '}
                                                {pendingTransaction.fromToken}
                                            </p>
                                            <p>
                                                To:{' '}
                                                <span className="text-white">
                          {pendingTransaction.toToken}
                        </span>
                                            </p>
                                            <p className="text-yellow-500/80 text-xs mt-2">
                                                ⚠️ Verify the price impact is acceptable.
                                            </p>
                                        </div>
                                        <div className="flex gap-2 mt-4">
                                            <Button
                                                onClick={() => {}}
                                                disabled={transactionInProgress}
                                                className="bg-green-500/20 hover:bg-green-500/30 text-green-400"
                                            >
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Confirm Swap
                                            </Button>
                                            <Button
                                                variant="outline"
                                                onClick={() => {
                                                    setPendingTransaction(null);
                                                    setResponse('Swap cancelled by user.');
                                                }}
                                                disabled={transactionInProgress}
                                                className="border-red-500/50 text-red-400 hover:bg-red-500/20"
                                            >
                                                <X className="w-4 h-4 mr-2" />
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <RecentTransactions
                            transactions={recentTransactions}
                            isLoading={isLoadingTransactions}
                            walletAddress={publicKey.toString()}
                        />
                    </div>
                </div>
            </div>
            <footer className="relative text-center py-8 mt-8">
                <div className="text-sm text-gray-500 space-y-2">
                    <p className="flex items-center justify-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                        Solana Mainnet
                    </p>
                    <div className="flex items-center justify-center gap-4">
                        <a
                            href={getExplorerUrl(`/account/${publicKey?.toString()}`, 'mainnet-beta')}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
                        >
                            <ExternalLink className="w-3 h-3" />
                            View in Explorer
                        </a>
                        <button
                            onClick={() => {
                                if (publicKey) {
                                    navigator.clipboard.writeText(publicKey.toString());
                                    setResponse('Address copied to clipboard!');
                                }
                            }}
                            className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
                        >
                            <Copy className="w-3 h-3" />
                            Copy Address
                        </button>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default WalletDashboard;
