import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ModerationRequest {
  content: string;
  mediaUrl?: string;
  contentType: 'post' | 'comment' | 'message' | 'story';
}

interface ModerationResult {
  approved: boolean;
  score: number;
  category?: string;
  reason?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { content, mediaUrl, contentType }: ModerationRequest = await req.json();

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    console.log('Moderating content:', { contentType, hasMedia: !!mediaUrl });

    // Check if it's a video - we can only moderate the text description
    const isVideo = mediaUrl && (
      mediaUrl.includes('.mp4') ||
      mediaUrl.includes('.mov') ||
      mediaUrl.includes('.webm') ||
      mediaUrl.includes('.ogg') ||
      mediaUrl.toLowerCase().includes('.mp4') ||
      mediaUrl.toLowerCase().includes('.mov')
    );

    // If it's a video with no text or safe text, approve it automatically
    if (isVideo && (!content || content.trim().length < 5)) {
      console.log('Video with minimal text - auto-approving');
      return new Response(JSON.stringify({
        approved: true,
        score: 0,
        category: 'safe',
        reason: 'Video aprobado - contenido multimedia'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build prompt for moderation
    const prompt = `You are a content moderation AI. Analyze the provided TEXT content and determine if it violates any of these policies:

1. Contenuti diffamatori, discriminatori o malevoli (religione, razza, orientamento sessuale, genere, origine)
2. Rappresentazioni realistiche di violenza, mutilazione, tortura o abuso
3. Contenuti che incoraggiano l'uso illegale di armi o facilitano l'acquisto di armi
4. Materiale apertamente sessuale o pornografico
5. Informazioni false o fuorvianti, funzionalità ingannevoli
6. Contenuti dannosi che capitalizzano su eventi recenti (conflitti, terrorismo, epidemie)

IMPORTANT: Only analyze the TEXT content. If the text is safe or empty, approve it.
Be permissive - only reject clearly offensive content.

Text to analyze:
${content || '(contenido vacío - aprobar)'}

Respond ONLY with a JSON object in this exact format:
{
  "approved": true/false,
  "score": 0-100 (0=safe, 100=extremely harmful),
  "category": "one of: hate_speech, violence, weapons, sexual_content, misinformation, harmful_exploitation, safe",
  "reason": "brief explanation in Spanish"
}`;

    // Call Google Gemini API directly
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.3,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);

      if (response.status === 429) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded. Please try again later.',
          approved: false,
          score: 50,
          category: 'rate_limited',
          reason: 'Troppi tentativi. Riprova tra qualche minuto.'
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log('Gemini Response:', aiResponse);

    // Parse AI response
    let result: ModerationResult;
    try {
      // Try to extract JSON from response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Default to safe if parsing fails
      result = {
        approved: true,
        score: 0,
        category: 'safe',
        reason: 'Contenuto analizzato e approvato'
      };
    }

    // Log moderation result
    console.log('Moderation result:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in moderate-content function:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      approved: false,
      score: 50,
      category: 'error',
      reason: 'Errore durante la moderazione. Riprova.'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});