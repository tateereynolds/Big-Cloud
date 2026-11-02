variable "subscription_id" {
  description = "Azure for Students subscription containing the existing timer."
  type        = string
  default     = "ce5dc3b1-713b-4760-a745-2cb71ef53043"
}

variable "tenant_id" {
  description = "Microsoft Entra tenant containing the existing subscription."
  type        = string
  default     = "79c742c4-e61c-4fa5-be89-a3cb566a80d1"
}
