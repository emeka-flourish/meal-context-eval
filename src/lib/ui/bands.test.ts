import { describe, expect, it } from 'vitest'
import { agreementLight, errorPctLight, inventedLight, shareLight } from './bands'

describe('stoplight bands', () => {
  it('scores: green from 0.80, amber from 0.60, red below', () => {
    expect(shareLight(0.8)).toBe('good')
    expect(shareLight(0.796)).toBe('good') // printed as 0.80
    expect(shareLight(0.79)).toBe('watch')
    expect(shareLight(0.6)).toBe('watch')
    expect(shareLight(0.59)).toBe('poor')
    expect(shareLight(null)).toBeNull()
  })
  it('agreement: share of scenes in percent', () => {
    expect(agreementLight(8, 10)).toBe('good')
    expect(agreementLight(7, 10)).toBe('watch')
    expect(agreementLight(5, 10)).toBe('poor')
    expect(agreementLight(0, 0)).toBeNull()
  })
  it('invented runs the other way', () => {
    expect(inventedLight(0.1)).toBe('good')
    expect(inventedLight(0.11)).toBe('watch')
    expect(inventedLight(0.25)).toBe('watch')
    expect(inventedLight(0.26)).toBe('poor')
  })
  it('nutrient error percent', () => {
    expect(errorPctLight(20)).toBe('good')
    expect(errorPctLight(21)).toBe('watch')
    expect(errorPctLight(40)).toBe('watch')
    expect(errorPctLight(41)).toBe('poor')
    expect(errorPctLight(undefined)).toBeNull()
  })
})
