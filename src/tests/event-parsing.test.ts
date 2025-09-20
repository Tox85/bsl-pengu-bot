// Tests unitaires pour le parsing d'events
import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';

// Mock des données de test
const mockTransferLog = {
  address: '0xfA928D3ABc512383b8E5E77edd2d5678696084F9',
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0x0000000000000000000000000000000000000000000000000000000000000000',
    '0x0000000000000000000000006d9dbe056a00b2cd3156da90f8589e504f4a33d4',
    '0x0000000000000000000000000000000000000000000000000000000000009547'
  ],
  data: '0x'
};

const mockCollectLog = {
  address: '0xfA928D3ABc512383b8E5E77edd2d5678696084F9',
  topics: [
    '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0',
    '0x0000000000000000000000000000000000000000000000000000000000009547'
  ],
  data: '0x0000000000000000000000006d9dbe056a00b2cd3156da90f8589e504f4a33d4000000000000000000000000000000000000000000000000000000000000004a90000000000000000000000000000000000000000000000000065761966cdc731'
};

describe('Event Parsing', () => {
  it('should extract tokenId from Transfer event with 64-char from address', () => {
    // Test de l'extraction du tokenId depuis un Transfer event
    const fromAddress = mockTransferLog.topics[1];
    const toAddress = mockTransferLog.topics[2];
    const tokenId = mockTransferLog.topics[3];
    
    expect(fromAddress).toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    expect(toAddress).toBe('0x0000000000000000000000006d9dbe056a00b2cd3156da90f8589e504f4a33d4');
    expect(tokenId).toBe('0x0000000000000000000000000000000000000000000000000000000000009547');
    
    // Conversion en BigInt
    const tokenIdBigInt = BigInt(tokenId);
    expect(tokenIdBigInt).toBe(38215n);
  });

  it('should parse Collect event with amounts', () => {
    // Test du parsing d'un event Collect
    const tokenId = mockCollectLog.topics[1];
    const data = mockCollectLog.data;
    
    expect(tokenId).toBe('0x0000000000000000000000000000000000000000000000000000000000009547');
    
    // Décodage des données (simplifié)
    const recipient = '0x' + data.slice(26, 66);
    const amount0 = '0x' + data.slice(66, 130);
    const amount1 = '0x' + data.slice(130, 194);
    
    expect(recipient).toBe('0x6d9dbe056a00b2cd3156da90f8589e504f4a33d4');
    expect(amount0).toBe('0x00000000000000000000000000000000000000000000000000000000000004a9');
    expect(amount1).toBe('0x00000000000000000000000000000000000000000000000065761966cdc731');
    
    // Conversion en BigInt
    const amount0BigInt = BigInt(amount0);
    const amount1BigInt = BigInt(amount1);
    
    expect(amount0BigInt).toBe(1193n);
    expect(amount1BigInt).toBe(28558824118798129n);
  });
});
