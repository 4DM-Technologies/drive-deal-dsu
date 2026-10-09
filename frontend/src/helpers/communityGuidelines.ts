const blockedTerms = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'motherfucker', 'bullshit', 'piss'];
const leetCharacters: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

export const CHAT_GUIDELINES_NOTICE = 'Please keep messages respectful. This wording violates our community guidelines.';

export function violatesChatGuidelines(message: string): boolean {
  const normalized = message.normalize('NFKC').toLowerCase().replace(/[013457@$]/g, (character) => leetCharacters[character] ?? character);
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return words.some((word) => blockedTerms.some((term) => word.startsWith(term))) || blockedTerms.some((term) => compact.includes(term));
}
