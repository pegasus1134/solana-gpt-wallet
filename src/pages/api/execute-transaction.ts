// pages/api/execute-transaction.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { GPTService } from '@/services/gpt.service';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

interface ExecuteResponse {
    signature?: string;
    error?: string;
}

let gptService: GPTService | null = null;

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<ExecuteResponse>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { amount, toAddress } = req.body;
        if (!amount || !toAddress) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        // Initialize service only once
        if (!gptService) {
            if (!process.env.AGENT_PRIVATE_KEY) {
                throw new Error('Agent private key is required');
            }

            gptService = new GPTService(
                process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
                process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
                process.env.AGENT_PRIVATE_KEY // Pass the base58 key directly
            );

            // Check agent wallet balance
            const agentKey = gptService.agent.wallet.publicKey;
            const balance = await gptService.agent.connection.getBalance(agentKey);
            console.log(`Agent ${agentKey.toBase58()} balance: ${balance / LAMPORTS_PER_SOL} SOL`);

            if (balance < 0.001 * LAMPORTS_PER_SOL) {
                throw new Error('Insufficient agent wallet balance. Please fund the agent wallet.');
            }
        }

        const result = await gptService.executeSend({
            action: 'send',
            amount,
            toAddress,
            message: 'Executing transaction'
        });

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error executing transaction:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
}