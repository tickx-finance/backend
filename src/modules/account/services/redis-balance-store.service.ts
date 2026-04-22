import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { BalanceDelta, BalanceState } from '../types';

export interface AtomicBalanceMutation {
    status: 'APPLIED' | 'DUPLICATE';
    balance: BalanceState;
}

const ATOMIC_APPLY_BALANCE_DELTA_SCRIPT = `
local SCALE = 9

local function normalize(n)
  n = tostring(n)
  local sign = ''
  if string.sub(n, 1, 1) == '-' then
    sign = '-'
    n = string.sub(n, 2)
  end
  n = string.gsub(n, '^0+', '')
  if n == '' then
    return '0'
  end
  return sign .. n
end

local function is_negative(n)
  return string.sub(normalize(n), 1, 1) == '-'
end

local function abs_value(n)
  n = normalize(n)
  if string.sub(n, 1, 1) == '-' then
    return string.sub(n, 2)
  end
  return n
end

local function cmp_abs(a, b)
  a = abs_value(a)
  b = abs_value(b)
  if string.len(a) ~= string.len(b) then
    if string.len(a) > string.len(b) then return 1 else return -1 end
  end
  if a == b then return 0 end
  if a > b then return 1 else return -1 end
end

local function add_abs(a, b)
  a = abs_value(a)
  b = abs_value(b)
  local carry = 0
  local out = ''
  local i = string.len(a)
  local j = string.len(b)
  while i > 0 or j > 0 or carry > 0 do
    local da = 0
    local db = 0
    if i > 0 then da = tonumber(string.sub(a, i, i)); i = i - 1 end
    if j > 0 then db = tonumber(string.sub(b, j, j)); j = j - 1 end
    local sum = da + db + carry
    out = tostring(sum % 10) .. out
    carry = math.floor(sum / 10)
  end
  return normalize(out)
end

local function sub_abs(a, b)
  a = abs_value(a)
  b = abs_value(b)
  local borrow = 0
  local out = ''
  local i = string.len(a)
  local j = string.len(b)
  while i > 0 do
    local da = tonumber(string.sub(a, i, i)) - borrow
    local db = 0
    if j > 0 then db = tonumber(string.sub(b, j, j)); j = j - 1 end
    if da < db then
      da = da + 10
      borrow = 1
    else
      borrow = 0
    end
    out = tostring(da - db) .. out
    i = i - 1
  end
  return normalize(out)
end

local function add_signed(a, b)
  a = normalize(a)
  b = normalize(b)
  local an = is_negative(a)
  local bn = is_negative(b)
  if an == bn then
    local sum = add_abs(a, b)
    if an and sum ~= '0' then return '-' .. sum end
    return sum
  end
  local cmp = cmp_abs(a, b)
  if cmp == 0 then return '0' end
  if cmp > 0 then
    local diff = sub_abs(a, b)
    if an then return '-' .. diff end
    return diff
  end
  local diff = sub_abs(b, a)
  if bn then return '-' .. diff end
  return diff
end

local function decimal_to_units(value)
  value = tostring(value)
  local sign = ''
  if string.sub(value, 1, 1) == '-' then
    sign = '-'
    value = string.sub(value, 2)
  end

  local dot = string.find(value, '%.')
  local whole = value
  local fractional = ''
  if dot ~= nil then
    whole = string.sub(value, 1, dot - 1)
    fractional = string.sub(value, dot + 1)
  end

  while string.len(fractional) < SCALE do
    fractional = fractional .. '0'
  end
  if string.len(fractional) > SCALE then
    fractional = string.sub(fractional, 1, SCALE)
  end

  local units = normalize(whole .. fractional)
  if sign == '-' and units ~= '0' then return '-' .. units end
  return units
end

local function units_to_decimal(units)
  units = normalize(units)
  local sign = ''
  if string.sub(units, 1, 1) == '-' then
    sign = '-'
    units = string.sub(units, 2)
  end

  while string.len(units) <= SCALE do
    units = '0' .. units
  end

  local whole = string.sub(units, 1, string.len(units) - SCALE)
  local fractional = string.sub(units, string.len(units) - SCALE + 1)
  whole = string.gsub(whole, '^0+', '')
  if whole == '' then whole = '0' end
  fractional = string.gsub(fractional, '0+$', '')

  if fractional == '' then
    if whole == '0' then return '0' end
    return sign .. whole
  end
  return sign .. whole .. '.' .. fractional
end

local stateKey = KEYS[1]
local dedupKey = KEYS[2]
local freeDelta = decimal_to_units(ARGV[1])
local freeTapDelta = decimal_to_units(ARGV[2])
local lockedDelta = decimal_to_units(ARGV[3])
local initFree = ARGV[4]
local initFreeTap = ARGV[5]
local initLocked = ARGV[6]
local initLedgerSeq = ARGV[7]

if redis.call('EXISTS', dedupKey) == 1 then
  return {
    'DUPLICATE',
    redis.call('HGET', stateKey, 'free') or initFree,
    redis.call('HGET', stateKey, 'freeTap') or initFreeTap,
    redis.call('HGET', stateKey, 'locked') or initLocked,
    redis.call('HGET', stateKey, 'ledgerSeq') or initLedgerSeq
  }
end

if redis.call('EXISTS', stateKey) == 0 then
  redis.call('HSET', stateKey, 'free', initFree, 'freeTap', initFreeTap, 'locked', initLocked, 'ledgerSeq', initLedgerSeq)
end

local free = redis.call('HGET', stateKey, 'free') or '0'
local freeTap = redis.call('HGET', stateKey, 'freeTap') or '0'
local locked = redis.call('HGET', stateKey, 'locked') or '0'
local ledgerSeq = redis.call('HGET', stateKey, 'ledgerSeq') or '0'

local newFreeUnits = add_signed(decimal_to_units(free), freeDelta)
local newFreeTapUnits = add_signed(decimal_to_units(freeTap), freeTapDelta)
local newLockedUnits = add_signed(decimal_to_units(locked), lockedDelta)

if is_negative(newFreeUnits) or is_negative(newFreeTapUnits) or is_negative(newLockedUnits) then
  return {'INSUFFICIENT', free, freeTap, locked, ledgerSeq}
end

local newFree = units_to_decimal(newFreeUnits)
local newFreeTap = units_to_decimal(newFreeTapUnits)
local newLocked = units_to_decimal(newLockedUnits)
local newLedgerSeq = add_signed(ledgerSeq, '1')
redis.call('HSET', stateKey, 'free', newFree, 'freeTap', newFreeTap, 'locked', newLocked, 'ledgerSeq', newLedgerSeq)
redis.call('SET', dedupKey, newLedgerSeq)

return {'APPLIED', newFree, newFreeTap, newLocked, newLedgerSeq}
`;

@Injectable()
export class RedisBalanceStoreService {
    constructor(@InjectRedis() private readonly redis: Redis) { }

    async get(userId: string): Promise<BalanceState | undefined> {
        const values = await this.redis.hmget(this.stateKey(userId), 'free', 'freeTap', 'locked', 'ledgerSeq');
        if (values.every((value) => value == null)) {
            return undefined;
        }

        return {
            userId,
            free: values[0] ?? '0',
            freeTap: values[1] ?? '0',
            locked: values[2] ?? '0',
            lastLedgerSeq: values[3] ?? '0',
        };
    }

    async set(userId: string, balance: BalanceState): Promise<void> {
        await this.redis.hset(this.stateKey(userId), {
            free: balance.free,
            freeTap: balance.freeTap,
            locked: balance.locked,
            ledgerSeq: balance.lastLedgerSeq,
        });
    }

    async applyDelta(
        userId: string,
        economicKey: string,
        delta: BalanceDelta,
        initialBalance: BalanceState,
    ): Promise<AtomicBalanceMutation> {
        this.assertDecimalDelta(delta);

        const result = await this.redis.eval(
            ATOMIC_APPLY_BALANCE_DELTA_SCRIPT,
            2,
            this.stateKey(userId),
            this.dedupKey(userId, economicKey),
            delta.free,
            delta.freeTap,
            delta.locked,
            initialBalance.free,
            initialBalance.freeTap,
            initialBalance.locked,
            initialBalance.lastLedgerSeq,
        ) as string[];

        const [status, free, freeTap, locked, ledgerSeq] = result;
        const balance: BalanceState = {
            userId,
            free,
            freeTap,
            locked,
            lastLedgerSeq: ledgerSeq,
        };

        if (status === 'INSUFFICIENT') {
            throw new BadRequestException('Insufficient balance');
        }

        if (status !== 'APPLIED' && status !== 'DUPLICATE') {
            throw new Error(`Unexpected Redis balance mutation status: ${status}`);
        }

        return { status, balance };
    }

    private assertDecimalDelta(delta: BalanceDelta) {
        for (const value of [delta.free, delta.freeTap, delta.locked]) {
            if (!this.isDecimalBalance(value)) {
                throw new BadRequestException('Balance delta must be a decimal string with max 9 fractional digits');
            }
        }
    }

    private isDecimalBalance(value: string): boolean {
        return /^-?(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value);
    }

    private stateKey(userId: string): string {
        return `account:{${userId}}:state`;
    }

    private dedupKey(userId: string, economicKey: string): string {
        return `account:{${userId}}:dedup:${economicKey}`;
    }
}
