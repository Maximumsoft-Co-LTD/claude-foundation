# pricing

## Purpose

Checkout pricing rules.

## Requirements

### Requirement: Loyalty tiers

Checkout SHALL grant a loyalty discount from the customer's point balance:
0% below 1000 points, 5% from 1000 points, and 10% from 5000 points.

#### Scenario: Silver tier

- **GIVEN** a customer with at least 1000 and fewer than 5000 points
- **WHEN** the order is priced
- **THEN** a 5% discount applies

#### Scenario: Gold tier

- **GIVEN** a customer with at least 5000 points
- **WHEN** the order is priced
- **THEN** a 10% discount applies

#### Scenario: No tier

- **GIVEN** a customer with fewer than 1000 points
- **WHEN** the order is priced
- **THEN** no discount applies

### Requirement: Discount rounding

The discount SHALL be rounded to the nearest cent, with half a cent rounded
up, and the total SHALL equal the subtotal minus the discount.

#### Scenario: Half cent

- **GIVEN** a 5% discount on a 1010 cent subtotal
- **WHEN** the order is priced
- **THEN** the discount is 51 cents and the total is 959 cents

### Requirement: Point validation

Pricing SHALL reject a negative or non-integer point balance with a RangeError.

#### Scenario: Negative balance

- **GIVEN** a balance of -1 points
- **WHEN** the order is priced
- **THEN** a RangeError is thrown
