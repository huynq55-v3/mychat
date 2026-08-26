import Mathlib.Tactic

namespace ConicSection

/-- Đa thức bậc hai 2 biến: P(x, y) = ax^2 + bxy + cy^2 + dx + ey + h -/
structure QuadraticPolynomial where
  a : ℝ
  b : ℝ
  c : ℝ
  d : ℝ
  e : ℝ
  h : ℝ

/-- Giá trị của đa thức tại (x, y) -/
def QuadraticPolynomial.eval (p : QuadraticPolynomial) (x y : ℝ) : ℝ :=
  p.a * x^2 + p.b * x * y + p.c * y^2 + p.d * x + p.e * y + p.h

/-- Biệt thức discriminant: Δ = b^2 - 4ac -/
def discriminant (p : QuadraticPolynomial) : ℝ :=
  p.b ^ 2 - 4 * p.a * p.c

/-- Phép biến đổi toạ độ Afin khả nghịch trên ℝ²:
    x = m11 * X + m12 * Y + x0
    y = m21 * X + m22 * Y + y0
    với det(M) = m11 * m22 - m12 * m21 ≠ 0 -/
structure AffineTransform where
  m11 : ℝ
  m12 : ℝ
  m21 : ℝ
  m22 : ℝ
  x0  : ℝ
  y0  : ℝ
  det_ne_zero : m11 * m22 - m12 * m21 ≠ 0

/-- Đa thức sau khi đổi biến qua phép biến đổi Afin T -/
def transform (p : QuadraticPolynomial) (T : AffineTransform) : QuadraticPolynomial where
  a := p.a * T.m11^2 + p.b * T.m11 * T.m21 + p.c * T.m21^2
  b := 2 * p.a * T.m11 * T.m12 + p.b * (T.m11 * T.m22 + T.m12 * T.m21) + 2 * p.c * T.m21 * T.m22
  c := p.a * T.m12^2 + p.b * T.m12 * T.m22 + p.c * T.m22^2
  d := 2 * p.a * T.m11 * T.x0 + p.b * (T.m11 * T.y0 + T.x0 * T.m21) + 2 * p.c * T.m21 * T.y0 + p.d * T.m11 + p.e * T.m21
  e := 2 * p.a * T.m12 * T.x0 + p.b * (T.m12 * T.y0 + T.x0 * T.m22) + 2 * p.c * T.m22 * T.y0 + p.d * T.m12 + p.e * T.m22
  h := p.eval T.x0 T.y0

/-- Tính chất bảo toàn giá trị của phép đổi biến -/
theorem eval_transform (p : QuadraticPolynomial) (T : AffineTransform) (X Y : ℝ) :
    (transform p T).eval X Y = p.eval (T.m11 * X + T.m12 * Y + T.x0) (T.m21 * X + T.m22 * Y + T.y0) := by
  dsimp [QuadraticPolynomial.eval, transform]
  ring

/-- Định thức của ma trận Jacobi của T -/
def AffineTransform.det (T : AffineTransform) : ℝ :=
  T.m11 * T.m22 - T.m12 * T.m21

/-- Bổ đề bất biến quan trọng: Biệt thức biến đổi theo (det T)² -/
theorem discriminant_transform (p : QuadraticPolynomial) (T : AffineTransform) :
    discriminant (transform p T) = (T.det)^2 * discriminant p := by
  dsimp [discriminant, transform, AffineTransform.det]
  ring

/-- Hai đa thức tương đương afin nếu một đa thức nhận được từ đa thức kia
    qua một phép đổi biến afin và nhân với một hằng số tỉ lệ k ≠ 0 -/
def AffineEquivalent (p q : QuadraticPolynomial) : Prop :=
  ∃ (T : AffineTransform) (k : ℝ), k ≠ 0 ∧
    (transform p T).a = k * q.a ∧
    (transform p T).b = k * q.b ∧
    (transform p T).c = k * q.c ∧
    (transform p T).d = k * q.d ∧
    (transform p T).e = k * q.e ∧
    (transform p T).h = k * q.h

/-- Bổ đề: Nếu p và q tương đương afin với hệ số tỉ lệ k thì biệt thức thoả mãn quan hệ tỉ lệ -/
theorem discriminant_affineEquivalent {p q : QuadraticPolynomial} (h : AffineEquivalent p q) :
    ∃ (M k : ℝ), M > 0 ∧ k ≠ 0 ∧ M * discriminant p = k^2 * discriminant q := by
  rcases h with ⟨T, k, hk, ha, hb, hc, _, _, _⟩
  use (T.det)^2, k
  refine ⟨?_, hk, ?_⟩
  · have hne := T.det_ne_zero
    exact sq_pos_of_ne_zero hne
  · have h1 : discriminant (transform p T) = (T.det)^2 * discriminant p := discriminant_transform p T
    have h2 : discriminant (transform p T) = k^2 * discriminant q := by
      dsimp [discriminant]
      rw [ha, hb, hc]
      ring
    rw [← h1, h2]

/-- Đa thức Parabol chuẩn tắc: Y - α X² = 0 (α ≠ 0) -/
def StandardParabola (α : ℝ) : QuadraticPolynomial where
  a := α
  b := 0
  c := 0
  d := 0
  e := -1
  h := 0

/-- Đa thức Elip chuẩn tắc: X²/α² + Y²/β² - 1 = 0 (α > 0, β > 0) -/
noncomputable def StandardEllipse (α β : ℝ) : QuadraticPolynomial where
  a := 1 / (α^2)
  b := 0
  c := 1 / (β^2)
  d := 0
  e := 0
  h := -1

/-- Đa thức Hyperbol chuẩn tắc: X²/α² - Y²/β² - 1 = 0 (α > 0, β > 0) -/
noncomputable def StandardHyperbola (α β : ℝ) : QuadraticPolynomial where
  a := 1 / (α^2)
  b := 0
  c := - (1 / (β^2))
  d := 0
  e := 0
  h := -1

/-- 1. ĐỊNH NGHĨA PARABOL: Là đa thức tương đương afin với một Parabol chuẩn tắc -/
def IsParabola (p : QuadraticPolynomial) : Prop :=
  ∃ (α : ℝ), α ≠ 0 ∧ AffineEquivalent p (StandardParabola α)

/-- 2. ĐỊNH NGHĨA ELIP: Là đa thức tương đương afin với một Elip chuẩn tắc -/
def IsEllipse (p : QuadraticPolynomial) : Prop :=
  ∃ (α β : ℝ), α > 0 ∧ β > 0 ∧ AffineEquivalent p (StandardEllipse α β)

/-- 3. ĐỊNH NGHĨA HYPERBOL: Là đa thức tương đương afin với một Hyperbol chuẩn tắc -/
def IsHyperbola (p : QuadraticPolynomial) : Prop :=
  ∃ (α β : ℝ), α > 0 ∧ β > 0 ∧ AffineEquivalent p (StandardHyperbola α β)

/-- Biệt thức của Parabol chuẩn tắc bằng 0 -/
theorem discriminant_standardParabola (α : ℝ) :
    discriminant (StandardParabola α) = 0 := by
  dsimp [discriminant, StandardParabola]
  ring

/-- Biệt thức của Elip chuẩn tắc luôn âm (< 0) -/
theorem discriminant_standardEllipse {α β : ℝ} (hα : α > 0) (hβ : β > 0) :
    discriminant (StandardEllipse α β) < 0 := by
  dsimp [discriminant, StandardEllipse]
  have hα2 : α^2 > 0 := sq_pos_of_pos hα
  have hβ2 : β^2 > 0 := sq_pos_of_pos hβ
  have h_prod : (1 / α^2) * (1 / β^2) > 0 := mul_pos (one_div_pos.mpr hα2) (one_div_pos.mpr hβ2)
  linarith

/-- Biệt thức của Hyperbol chuẩn tắc luôn dương (> 0) -/
theorem discriminant_standardHyperbola {α β : ℝ} (hα : α > 0) (hβ : β > 0) :
    discriminant (StandardHyperbola α β) > 0 := by
  dsimp [discriminant, StandardHyperbola]
  have hα2 : α^2 > 0 := sq_pos_of_pos hα
  have hβ2 : β^2 > 0 := sq_pos_of_pos hβ
  have h_prod : (1 / α^2) * (1 / β^2) > 0 := mul_pos (one_div_pos.mpr hα2) (one_div_pos.mpr hβ2)
  linarith

-- =========================================================================
-- THEOREM 1.1.20: PHÂN LOẠI CÁC ĐƯỜNG CONIC THEO BIỆT THỨC Δ = b² - 4ac
-- =========================================================================

/-- (1) Nếu V(P) là Parabol thì b² - 4ac = 0 -/
theorem theorem_1_1_20_parabola {p : QuadraticPolynomial} (h : IsParabola p) :
    discriminant p = 0 := by
  rcases h with ⟨α, _, hequiv⟩
  obtain ⟨M, k, hM, hk, hrel⟩ := discriminant_affineEquivalent hequiv
  rw [discriminant_standardParabola α] at hrel
  rw [mul_zero] at hrel
  have hM_ne : M ≠ 0 := ne_of_gt hM
  exact (mul_eq_zero.mp hrel).resolve_left hM_ne

/-- (2) Nếu V(P) là Elip thì b² - 4ac < 0 -/
theorem theorem_1_1_20_ellipse {p : QuadraticPolynomial} (h : IsEllipse p) :
    discriminant p < 0 := by
  rcases h with ⟨α, β, hα, hβ, hequiv⟩
  obtain ⟨M, k, hM, hk, hrel⟩ := discriminant_affineEquivalent hequiv
  have h_std_neg : discriminant (StandardEllipse α β) < 0 := discriminant_standardEllipse hα hβ
  have hk2_pos : k^2 > 0 := sq_pos_of_ne_zero hk
  have h_rhs_neg : k^2 * discriminant (StandardEllipse α β) < 0 := mul_neg_of_pos_of_neg hk2_pos h_std_neg
  have h_lhs_neg : M * discriminant p < 0 := by linarith
  nlinarith

/-- (3) Nếu V(P) là Hyperbol thì b² - 4ac > 0 -/
theorem theorem_1_1_20_hyperbola {p : QuadraticPolynomial} (h : IsHyperbola p) :
    discriminant p > 0 := by
  rcases h with ⟨α, β, hα, hβ, hequiv⟩
  obtain ⟨M, k, hM, hk, hrel⟩ := discriminant_affineEquivalent hequiv
  have h_std_pos : discriminant (StandardHyperbola α β) > 0 := discriminant_standardHyperbola hα hβ
  have hk2_pos : k^2 > 0 := sq_pos_of_ne_zero hk
  have h_rhs_pos : k^2 * discriminant (StandardHyperbola α β) > 0 := mul_pos hk2_pos h_std_pos
  have h_lhs_pos : M * discriminant p > 0 := by linarith
  nlinarith

/-- Tổng hợp toàn bộ phát biểu của THEOREM 1.1.20 -/
theorem theorem_1_1_20 (p : QuadraticPolynomial) :
    (IsParabola p → discriminant p = 0) ∧
    (IsEllipse p → discriminant p < 0) ∧
    (IsHyperbola p → discriminant p > 0) := by
  refine ⟨theorem_1_1_20_parabola, theorem_1_1_20_ellipse, theorem_1_1_20_hyperbola⟩

end ConicSection
