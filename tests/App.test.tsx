import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'

describe('App (M0 placeholder)', () => {
  it('renders the title', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'NFL Faces' })).toBeInTheDocument()
  })
})
