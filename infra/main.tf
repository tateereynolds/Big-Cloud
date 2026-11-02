# The resource group's metadata region predates the app. Keep it unchanged.
resource "azurerm_resource_group" "focus" {
  name     = "focus-studio-rg"
  location = "centralus"

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_service_plan" "focus" {
  name                = "ASP-focusstudiorg-850e"
  resource_group_name = azurerm_resource_group.focus.name
  location            = "swedencentral"
  os_type             = "Linux"
  sku_name            = "F1"
  worker_count        = 1

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_linux_web_app" "focus" {
  name                = "focus-studio-tate"
  resource_group_name = azurerm_resource_group.focus.name
  location            = azurerm_service_plan.focus.location
  service_plan_id     = azurerm_service_plan.focus.id

  enabled                                        = true
  https_only                                     = true
  public_network_access_enabled                  = true
  client_affinity_enabled                        = false
  client_certificate_enabled                     = false
  client_certificate_mode                        = "Required"
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false

  app_settings = {
    SCM_DO_BUILD_DURING_DEPLOYMENT = "1"
  }

  # Preserve the existing disabled App Service authentication configuration.
  auth_settings {
    enabled                       = false
    token_refresh_extension_hours = 0
    token_store_enabled           = false
  }

  site_config {
    always_on                   = false # Required by the Free F1 plan.
    app_command_line            = "startup.txt"
    ftps_state                  = "FtpsOnly"
    http2_enabled               = false
    load_balancing_mode         = "LeastRequests"
    local_mysql_enabled         = false
    managed_pipeline_mode       = "Integrated"
    minimum_tls_version         = "1.2"
    remote_debugging_enabled    = false
    scm_minimum_tls_version     = "1.2"
    scm_use_main_ip_restriction = false
    use_32_bit_worker           = true
    vnet_route_all_enabled      = false
    websockets_enabled          = false
    worker_count                = 1

    application_stack {
      python_version = "3.12"
    }
  }

  lifecycle {
    prevent_destroy = true
    # Azure leaves these unset on the existing app. Preserve its implicit access
    # defaults rather than writing explicit Allow rules during adoption.
    ignore_changes = [
      site_config[0].ip_restriction_default_action,
      site_config[0].scm_ip_restriction_default_action,
    ]
  }
}
