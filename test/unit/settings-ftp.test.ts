// ============================================================================
// test/unit/settings-ftp.test.ts
// settings-ftp スキーマ + normalizeFtpSettings の単体テスト (P5-76)
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  settingsFtpSchema,
  normalizeFtpSettings,
} from '@/lib/validators/settings-ftp';

describe('settingsFtpSchema', () => {
  it('完全な valid input を受理する', () => {
    const input = {
      host: 'ftp.example.com',
      port: 21,
      user: 'admin',
      password: 'secret',
      secure: false,
      remoteBasePath: '/public_html/column/',
    };
    const result = settingsFtpSchema.parse(input);
    expect(result).toEqual(input);
  });

  it('port / secure はデフォルト値で補完される', () => {
    const input = {
      host: 'ftp.example.com',
      user: 'admin',
      password: 'secret',
      remoteBasePath: '/spiritual/column/',
    };
    const result = settingsFtpSchema.parse(input);
    expect(result.port).toBe(21);
    expect(result.secure).toBe(false);
  });

  it('必須フィールド (host) 欠如で throw する', () => {
    expect(() =>
      settingsFtpSchema.parse({
        user: 'admin',
        password: 'secret',
        remoteBasePath: '/x/',
      }),
    ).toThrow();
  });

  it('必須フィールド (remoteBasePath) 欠如で throw する', () => {
    expect(() =>
      settingsFtpSchema.parse({
        host: 'ftp.example.com',
        user: 'admin',
        password: 'secret',
      }),
    ).toThrow();
  });

  it('remoteBasePath が前後スラッシュで囲まれていなければ throw する', () => {
    expect(() =>
      settingsFtpSchema.parse({
        host: 'ftp.example.com',
        user: 'admin',
        password: 'secret',
        remoteBasePath: 'public_html/column/',
      }),
    ).toThrow();

    expect(() =>
      settingsFtpSchema.parse({
        host: 'ftp.example.com',
        user: 'admin',
        password: 'secret',
        remoteBasePath: '/public_html/column',
      }),
    ).toThrow();
  });

  it('未知キーは strict mode で reject する (将来の key drift 検出)', () => {
    expect(() =>
      settingsFtpSchema.parse({
        host: 'ftp.example.com',
        user: 'admin',
        password: 'secret',
        remoteBasePath: '/x/',
        // ↓ 未知キー: 将来の typo / 別の key drift をここで loud failure
        someUnknownKey: 'oops',
      }),
    ).toThrow();
  });

  it('port が範囲外なら reject する', () => {
    expect(() =>
      settingsFtpSchema.parse({
        host: 'ftp.example.com',
        port: 0,
        user: 'admin',
        password: 'secret',
        remoteBasePath: '/x/',
      }),
    ).toThrow();

    expect(() =>
      settingsFtpSchema.parse({
        host: 'ftp.example.com',
        port: 70000,
        user: 'admin',
        password: 'secret',
        remoteBasePath: '/x/',
      }),
    ).toThrow();
  });
});

describe('normalizeFtpSettings', () => {
  it('canonical な remoteBasePath をそのまま通す', () => {
    const input = {
      host: 'ftp.example.com',
      user: 'admin',
      password: 'secret',
      remoteBasePath: '/spiritual/column/',
    };
    const result = normalizeFtpSettings(input);
    expect(result.remoteBasePath).toBe('/spiritual/column/');
  });

  it('レガシー remotePath を remoteBasePath に正規化する', () => {
    const legacyInput = {
      host: 'ftp.example.com',
      port: 21,
      user: 'admin',
      password: 'secret',
      secure: false,
      // ↓ レガシー UI が保存していたキー
      remotePath: '/spiritual/column/',
    };
    const result = normalizeFtpSettings(legacyInput);
    expect(result.remoteBasePath).toBe('/spiritual/column/');
    // remotePath は normalize で削除されているはず
    expect((result as Record<string, unknown>).remotePath).toBeUndefined();
  });

  it('必須フィールド欠如の入力は throw する', () => {
    expect(() =>
      normalizeFtpSettings({
        // host 欠如
        user: 'admin',
        password: 'secret',
        remoteBasePath: '/x/',
      }),
    ).toThrow();
  });

  it('未知キーは strict mode で throw する', () => {
    expect(() =>
      normalizeFtpSettings({
        host: 'ftp.example.com',
        user: 'admin',
        password: 'secret',
        remoteBasePath: '/x/',
        unexpectedExtra: 'drift',
      }),
    ).toThrow();
  });

  it('null / undefined / 非オブジェクトは throw する', () => {
    expect(() => normalizeFtpSettings(null)).toThrow();
    expect(() => normalizeFtpSettings(undefined)).toThrow();
    expect(() => normalizeFtpSettings('string')).toThrow();
    expect(() => normalizeFtpSettings(42)).toThrow();
  });

  it('レガシー remotePath が無効な値なら throw する (regex 違反は normalize 後でも残る)', () => {
    expect(() =>
      normalizeFtpSettings({
        host: 'ftp.example.com',
        user: 'admin',
        password: 'secret',
        remotePath: 'no-leading-slash/',
      }),
    ).toThrow();
  });
});
