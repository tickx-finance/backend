import { IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CommitBatchDto {
  @ApiProperty({
    description: 'Transaction hash of the commit transaction',
    example: '0xabc123def456789012345678901234567890123456789012345678901234abcd',
  })
  @IsString()
  txHash: string;

  @ApiProperty({
    description: 'Merkle root of the batch',
    example: '0xmerkleroot123456789012345678901234567890123456789012345678901234',
  })
  @IsString()
  merkleRoot: string;

  @ApiProperty({
    description: 'Unix timestamp (seconds) when the batch was committed',
    example: 1704068200,
    type: Number,
  })
  @IsInt()
  @Min(0)
  committedAt: number;
}
