// pages/api/process-command.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { GPTService } from '@/services/gpt.service';

interface CommandResponse {
    result?: any;
    error?: string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<CommandResponse>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { input, publicKey, balance } = req.body;
        if (!input || !publicKey) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Instantiate GPTService WITHOUT an agent private key (we're only using it for NLP)
        const service = new GPTService(
            process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
            'https://quick-snowy-spring.solana-mainnet.quiknode.pro/b8555444cea75763a432668664ab36f1d6dd64e0'
        );
        const response = await service.processUserInput(input, publicKey, balance);
        return res.status(200).json({ result: response });
    } catch (error) {
        console.error('Command processing error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
}
