// pages/api/execute-swap.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { GPTService } from '@/services/gpt.service';

interface SwapResponse {
    swapTransaction?: string; // serialized unsigned transaction (base64)
    message?: string;
    error?: string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<SwapResponse>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { fromToken, toToken, amount, walletAddress } = req.body;

        if (!amount || !fromToken || !toToken || !walletAddress) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        // Pass null for the agent key so that the transaction remains unsigned.
        const service = new GPTService(
            process.env.OPENAI_API_KEY || '',
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '',
            null
        );

        // Build the unsigned swap transaction.
        const serializedTx = await service.buildSwapTransaction({
            action: 'swap',
            amount: parseFloat(amount),
            fromToken,
            toToken,
            message: 'Preparing swap transaction',
            walletAddress
        });

        // If everything is successful, return the transaction.
        return res.status(200).json({
            swapTransaction: serializedTx,
            message: 'Swap transaction prepared successfully'
        });
    } catch (error) {
        console.error('Error in swap handler:', error);
        // Instead of throwing, check if the error is about swap routes
        if (error instanceof Error && error.message.includes('No swap routes found')) {
            return res.status(200).json({
                swapTransaction: null,
                error:
                    'No swap routes found. Please try a higher amount or a different token pair.'
            });
        }
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
}
