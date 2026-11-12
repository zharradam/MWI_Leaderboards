using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MWI_Leaderboards.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "MWI");

            migrationBuilder.CreateTable(
                name: "LeaderboardEntries",
                schema: "MWI",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    LeaderboardType = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    LeaderboardCategory = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    FetchedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Rank = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    ChatIconHrid = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    NameColorHrid = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    SpecialChatIconHrid = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Value1 = table.Column<long>(type: "bigint", nullable: false),
                    Value2 = table.Column<long>(type: "bigint", nullable: false),
                    IsPersonalRow = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeaderboardEntries", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LeaderboardEntries",
                schema: "MWI");
        }
    }
}
