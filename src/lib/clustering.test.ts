import { describe, it, expect } from 'vitest'
import { clusterArtifacts } from './clustering'

const at = (mins: number) => new Date(Date.UTC(2026, 7, 10, 12, mins))

describe('clusterArtifacts — rolling 30-min window', () => {
  it('empty input → no groups', () => {
    expect(clusterArtifacts([])).toEqual([])
  })

  it('single item → one singleton group', () => {
    expect(clusterArtifacts([{ id: 'a', takenAt: at(0) }])).toEqual([['a']])
  })

  it('two items within the window cluster together', () => {
    expect(
      clusterArtifacts([
        { id: 'a', takenAt: at(0) },
        { id: 'b', takenAt: at(29) },
      ])
    ).toEqual([['a', 'b']])
  })

  it('two items beyond the window split into two groups', () => {
    expect(
      clusterArtifacts([
        { id: 'a', takenAt: at(0) },
        { id: 'b', takenAt: at(31) },
      ])
    ).toEqual([['a'], ['b']])
  })

  it('rolling chain A-B-C each 20min apart clusters together (span > window)', () => {
    expect(
      clusterArtifacts([
        { id: 'a', takenAt: at(0) },
        { id: 'b', takenAt: at(20) },
        { id: 'c', takenAt: at(40) },
      ])
    ).toEqual([['a', 'b', 'c']])
  })

  it('sorts by time regardless of input order', () => {
    expect(
      clusterArtifacts([
        { id: 'b', takenAt: at(20) },
        { id: 'a', takenAt: at(0) },
        { id: 'c', takenAt: at(90) },
      ])
    ).toEqual([['a', 'b'], ['c']])
  })

  it('null timestamps are isolated singletons at the end', () => {
    expect(
      clusterArtifacts([
        { id: 'x', takenAt: null },
        { id: 'a', takenAt: at(0) },
        { id: 'b', takenAt: at(10) },
        { id: 'y', takenAt: null },
      ])
    ).toEqual([['a', 'b'], ['x'], ['y']])
  })

  it('respects a custom window', () => {
    expect(
      clusterArtifacts(
        [
          { id: 'a', takenAt: at(0) },
          { id: 'b', takenAt: at(10) },
        ],
        5
      )
    ).toEqual([['a'], ['b']])
  })
})
