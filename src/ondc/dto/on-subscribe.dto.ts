import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for ONDC /on_subscribe request from registry
 * This is sent by ONDC registry during subscription verification
 */
export class OnSubscribeRequestDto {
  @ApiProperty({
    description: 'The subscriber ID being verified',
    example: 'dev.quikboys.com',
  })
  @IsString()
  @IsNotEmpty()
  subscriber_id: string;

  @ApiProperty({
    description:
      'Base64-encoded encrypted challenge using X25519 public key. Contains ephemeral public key, nonce, ciphertext, and auth tag.',
    example: 'base64-encoded-encrypted-challenge',
  })
  @IsString()
  @IsNotEmpty()
  challenge: string;
}

/**
 * Response DTO for /on_subscribe
 * Returns the decrypted challenge as the answer
 */
export class OnSubscribeResponseDto {
  @ApiProperty({
    description: 'Decrypted challenge answer',
    example: 'decrypted-challenge-string',
  })
  answer: string;
}
