output "app_url" {
  description = "Existing HTTPS address, including Azure's unique hostname suffix."
  value       = "https://${azurerm_linux_web_app.focus.default_hostname}"
}

output "app_name" {
  value = azurerm_linux_web_app.focus.name
}

output "hosting_plan" {
  value = azurerm_service_plan.focus.sku_name
}
